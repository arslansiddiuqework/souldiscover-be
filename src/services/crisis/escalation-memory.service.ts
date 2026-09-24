/**
 * Escalation Memory Service
 * ─────────────────────────
 * Builds a condensed emergency call context from the existing session data.
 * Uses the existing Groq `generate()` function — NOT a new AI call.
 * Sends a summarized context to the emergency call, not raw chat history.
 */

import { ChatSession } from "../../models/ChatSession";
import { generate }    from "../llm.service";
import { logger }      from "../../utils/logger";

export async function buildEmergencyCallContext(
  sessionId: string,
  _userId: string
): Promise<string> {
  try {
    const session = await ChatSession.findOne({ sessionId });
    if (!session || !session.messages.length) {
      return "No recent session data available.";
    }

    // Last 10 user messages (condensed context)
    const userMessages = session.messages
      .filter((m) => m.role === "user")
      .slice(-10)
      .map((m) => `- "${m.content.slice(0, 150)}"`)
      .join("\n");

    // Emotional trajectory from stored metadata
    const emotionSamples = session.messages
      .filter((m) => m.metadata?.emotionMeta)
      .slice(-6)
      .map((m) => {
        const em = m.metadata!.emotionMeta!;
        return `${em.emotion} (${(em.intensity * 10).toFixed(1)}/10)`;
      })
      .join(" → ");

    const prompt = `You are summarizing a therapy session for an emergency contact notification.
Write 3-4 sentences describing the emotional state. Be factual, empathetic, and non-diagnostic.
Do NOT include names, personal details, or medical conclusions.

Recent user statements:
${userMessages}

Emotional progression: ${emotionSamples || "unavailable"}

Write the summary now:`;

    const summary = await generate(prompt, { maxTokens: 150, temperature: 0.3 });
    return summary.trim() || "The individual showed signs of significant emotional distress requiring support.";
  } catch (err) {
    logger.warn("[ESCALATION_MEMORY] Failed to build context", { error: String(err) });
    return "The individual showed signs of severe emotional distress during their wellness session.";
  }
}
