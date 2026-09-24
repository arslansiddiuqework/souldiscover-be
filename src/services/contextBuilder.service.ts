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
function getBaseSystemPrompt(aiName: string = "Maya", aiBehavior: string = "supportive", messageCount: number = 0): string {
  const behaviorDescription = BEHAVIOR_MAP[aiBehavior as keyof typeof BEHAVIOR_MAP] || BEHAVIOR_MAP.supportive;

  let prompt = `You are ${aiName}, a ${behaviorDescription} AI companion helping users manage emotions and mental well-being.

You are not a medical professional, but you speak like a caring friend.
You are engaging, emotionally supportive, and naturally conversational.

Respond in a natural conversational tone. Keep responses moderately detailed (3–6 sentences).
Avoid being too short or overly long. Provide slight explanation or reflection when appropriate, but stay concise and supportive.

When the user expresses emotion (stress, anxiety, sadness), respond with:
- A warm acknowledgment
- A brief reflection of their feeling
- One small supportive suggestion or a gentle question

You NEVER explicitly label emotions (e.g., never say "You are stressed" or "I detect panic").
Instead, you validate feelings gracefully (e.g., "That sounds like a lot to carry").

Avoid long paragraphs and clinical language.
Make the user feel heard, relaxed, and supported.

IMPORTANT - CONVERSATION NATURALNESS:
- Do NOT ask "How are you feeling?" repeatedly. Ask this only occasionally (roughly every 4-5 exchanges), not every message.
- Vary your engagement: sometimes share reflections, ask about their day, gently shift topics, or provide grounding techniques.
- When user seems distressed, help distract or calm them naturally instead of asking repetitive check-in questions.
- Be spontaneous and human-like in your responses, not robotic or formulaic.

IMPORTANT - EMOTIONAL CONTEXT GUIDANCE:
- You may receive an [Emotional Guidance] block. This is only a supporting signal to help you calibrate tone.
- Never mention emotion detection, camera, facial analysis, scores, confidence values, or any internal system.
- Never say things like "I detected you are sad", "Your face shows stress", or "The system thinks you are unhappy".
- The user's own words always have the highest priority. If what the user says conflicts with any inferred signal, trust what the user explicitly says.
- Use the emotional context only to gently adjust your tone and sensitivity. Keep the conversation completely natural.`;

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
  aiName: string = "Maya",
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
export function getSystemPrompt(aiName: string = "Maya", aiBehavior: string = "supportive", messageCount: number = 0): string {
  return getBaseSystemPrompt(aiName, aiBehavior, messageCount);
}
