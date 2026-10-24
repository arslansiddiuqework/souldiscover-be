/**
 * Assembles the final prompt sent to the LLM.
 * Implements HYBRID memory: always includes BOTH the summary AND recent messages.
 */

import { getRecentMessages, formatMessagesForPrompt, SimpleMessage } from "./memory.service";

// Behavior mapping for AI personality
const BEHAVIOR_MAP = {
  supportive: "empathetic, warm, and understanding",
  friendly: "casual, light-hearted, and conversational",
  motivational: "encouraging, energetic, and uplifting",
  calm: "slow, grounding, and therapist-like"
};

// Build base system prompt
function getBaseSystemPrompt(aiName: string = "Soul Discovery", aiBehavior: string = "supportive", messageCount: number = 0): string {
  const behaviorDescription = BEHAVIOR_MAP[aiBehavior as keyof typeof BEHAVIOR_MAP] || BEHAVIOR_MAP.supportive;

  let prompt = `You are ${aiName}, a ${behaviorDescription} wellness companion for Soul Discovery.

You help with everyday stress, anxiety, reflection, breathing, journaling, and sleep habits.
You are compassionate and nonjudgmental. You are NOT a licensed psychologist, psychiatrist, or medical professional.
Never diagnose conditions, prescribe medication, or claim clinical authority.

Speak like a caring friend. Keep replies moderately detailed (3–6 sentences), warm, and concise.
When the user shares stress, anxiety, or sadness:
- Warmly acknowledge what they shared
- Briefly reflect the feeling without clinical labels
- Offer one small supportive suggestion (breathing, journaling, gentle rest) or a thoughtful question

Never say "You are stressed" or "I detect panic". Validate gracefully (e.g., "That sounds like a lot to carry").

CRISIS & SAFETY:
- If the user expresses hopelessness, self-harm, or suicidal thoughts, respond with care and seriousness.
- Encourage them to seek immediate help from local emergency services, a trusted person, or a crisis hotline (e.g., call or text 988 in the US).
- Do not dig for graphic details. Stay present, supportive, and redirect toward real-world help.
- You cannot replace emergency or professional care.

CONVERSATION NATURALNESS:
- Do NOT ask "How are you feeling?" every message; only occasionally (roughly every 4–5 exchanges).
- Vary engagement: reflections, grounding, gentle topic shifts.
- Be human-like, not robotic or formulaic.

EMOTIONAL CONTEXT GUIDANCE:
- You may receive an [Emotional Guidance] block as a soft tone hint only.
- Never mention emotion detection, camera, facial analysis, scores, or any internal system.
- The user's own words always have the highest priority.`;

  if (messageCount > 0) {
    prompt += `\n\nConversation progress: ${messageCount} messages exchanged so far.`;
    if (messageCount % 5 === 1) {
      prompt += ` Consider a light check-in if appropriate, but keep it natural and contextual.`;
    }
  }

  return prompt;
}

// Validate fusion context string
function isValidFusionContext(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Max Context Budget
const MAX_CONTEXT_CHARS = 3000;

// Build prompt context
export function buildPrompt(
  userMessage: string,
  allMessages: SimpleMessage[],
  summary: string,
  userName?: string,
  latestMood?: "low" | "neutral" | "positive" | "unknown",
  aiName: string = "Soul Discovery",
  aiBehavior: string = "supportive",
  suggestedActivity?: string | null,
  fusionContext?: string
): string {
  const parts: string[] = [];
  const messageCount = allMessages.length;
  const hasFusion = isValidFusionContext(fusionContext);

  // ── Layer 1: System Prompt & Mood Awareness ──
  let systemPrompt = getBaseSystemPrompt(aiName, aiBehavior, messageCount);
  if (userName) {
    systemPrompt += `\n\nThe user's name is ${userName}.`;
  }

  // Inject latestMood ONLY when no fusion context is present (avoids conflict)
  if (!hasFusion && latestMood && latestMood !== "unknown") {
    systemPrompt += `\n\nThe user's last tracked mood was ${latestMood}.`;
    if (allMessages.length <= 1) {
      systemPrompt += `\nSince this is the beginning of the conversation, warmly and gently acknowledge this mood and ask how they are feeling today. If they were feeling low, make sure to console them first.`;
    }
  }

  if (suggestedActivity) {
    systemPrompt += `\n\nIMPORTANT: You are suggesting the "${suggestedActivity}" activity to the user. You MUST include this exact sentence in your response: "let me help you with this ${suggestedActivity} activity this might help you improve your mood".`;
  } else {
    systemPrompt += `\n\nIMPORTANT: Do not suggest any activities or say "let me help you with this..." in this response.`;
  }

  parts.push(systemPrompt);

  // ── Layer 2: Fusion Emotional Context (if available) ──
  if (hasFusion) {
    parts.push(fusionContext!);
  }

  // ── Layer 3: Long-term Memory (Summary) ──
  if (summary && summary.trim()) {
    parts.push(`[Conversation Summary]\n${summary.trim()}`);
  }

  // ── Layer 4: Short-term Memory (Recent Messages) ──
  const recent = getRecentMessages(allMessages);
  if (recent.length > 0) {
    const formatted = formatMessagesForPrompt(recent, aiName);
    parts.push(`[Recent Conversation]\n${formatted}`);
  }

  // ── Layer 5: Current User Message ──
  parts.push(`User: ${userMessage}\n${aiName}:`);

  // ── Assemble ──
  let prompt = parts.join("\n\n");

  // ── Budget Enforcement ──
  // Priority order is preserved: System → Fusion → Summary → Recent → User message.
  // Fusion context is never removed. Summary and recent messages are trimmed first.
  if (prompt.length > MAX_CONTEXT_CHARS) {
    const shorterRecent = getRecentMessages(allMessages, 6);
    const formatted = formatMessagesForPrompt(shorterRecent, aiName);

    const rebuiltParts: string[] = [systemPrompt];

    // Fusion context is always preserved
    if (hasFusion) {
      rebuiltParts.push(fusionContext!);
    }

    // Include summary only if there's room (truncated)
    if (summary && summary.trim()) {
      rebuiltParts.push(`[Summary]\n${summary.trim().slice(0, 300)}`);
    }
    rebuiltParts.push(`[Recent]\n${formatted}`);
    rebuiltParts.push(`User: ${userMessage}\n${aiName}:`);
    prompt = rebuiltParts.join("\n\n");
  }

  return prompt;
}

/**
 * Returns the system prompt constant for external use (e.g. logging).
 */
export function getSystemPrompt(aiName: string = "Soul Discovery", aiBehavior: string = "supportive", messageCount: number = 0): string {
  return getBaseSystemPrompt(aiName, aiBehavior, messageCount);
}
