import Groq from "groq-sdk";
import { logger } from "../utils/logger";

// Configuration
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_TIMEOUT_MS = 15_000;

// SDK Initialization
export const groq1 = new Groq({
  apiKey: process.env.GROQ_API_KEY_1 || "",
});
export const groq2 = new Groq({
  apiKey: process.env.GROQ_API_KEY_2 || "",
});

// Types
export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
}

export interface LLMResult {
  fullText: string;
  modelUsed: "groq";
  fallbackUsed: boolean;
  error?: boolean;
}

/**
 * Primary: Groq (llama-3.1-8b-instant)
 * Logic: Try Key 1. If fails (quota, timeout, invalid), try Key 2.
 */
export async function generateStream(
  prompt: string,
  onChunk: (text: string) => void,
  options: LLMOptions = {},
  signal?: AbortSignal
): Promise<LLMResult> {
  const maxTokens = options.maxTokens ?? 250;
  const temperature = options.temperature ?? 0.7;

  const keys = [groq1, groq2];
  let lastError: any = null;

  for (let i = 0; i < keys.length; i++) {
    const groq = keys[i];
    const isLastKey = i === keys.length - 1;
    let retryCount = 0;
    const maxRetries = 1; // Retry once on timeout

    while (retryCount <= maxRetries) {
      try {
        logger.info(`🚀 LLM: attempting Groq (Key ${i + 1}${retryCount > 0 ? " retry" : ""})`);

        const stream = await groq.chat.completions.create({
          model: GROQ_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_tokens: maxTokens,
          temperature: temperature,
          stream: true,
        }, {
          signal: signal,
          timeout: GROQ_TIMEOUT_MS
        });

        let fullText = "";
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || "";
          if (content) {
            fullText += content;
            onChunk(content);
          }
        }

        logger.info(`✅ LLM: Groq Key ${i + 1} succeeded`);
        return { fullText, modelUsed: "groq", fallbackUsed: i > 0 };

      } catch (error: any) {
        lastError = error;
        const status = error?.status;
        const message = error?.message?.toLowerCase() || "";

        // Error Classification
        
        // 1. Timeout -> retry once, then switch
        if (error.name === "AbortError" || message.includes("timeout") || status === 408) {
          if (retryCount < maxRetries) {
            logger.warn(`⚠️ LLM: Groq Key ${i + 1} timeout, retrying...`);
            retryCount++;
            continue;
          }
          logger.warn(`⚠️ LLM: Groq Key ${i + 1} timeout after retries, switching...`);
          break; // Switch to next key
        }

        // 2. Quota / Rate Limit (429) -> switch immediately
        if (status === 429 || message.includes("quota") || message.includes("rate limit")) {
          logger.warn(`⚠️ LLM: Groq Key ${i + 1} quota exceeded, switching...`);
          break; 
        }

        // 3. Invalid Key (401) -> switch immediately
        if (status === 401 || message.includes("invalid api key")) {
          logger.warn(`⚠️ LLM: Groq Key ${i + 1} invalid, switching...`);
          break;
        }

        // 4. Other errors -> switch immediately if not last key
        logger.error(`🔴 LLM: Groq Key ${i + 1} failed with error`, { error: message });
        break;
      }
    }
  }

  // If we reach here, both keys failed
  logger.error("🔴 LLM: All Groq keys failed", {
    error: lastError instanceof Error ? lastError.message : String(lastError)
  });

  const failMsg = "AI service is currently busy. Please try again in a moment.";
  onChunk(failMsg);
  
  return { fullText: failMsg, modelUsed: "groq", fallbackUsed: true, error: true };
}

// Non-Streaming Generation
/**
 * Used for background tasks (summarization, titles).
 * Also implements dual key failover.
 */
export async function generate(
  prompt: string,
  options: LLMOptions = {}
): Promise<string> {
  const keys = [groq1, groq2];
  
  for (let i = 0; i < keys.length; i++) {
    const groq = keys[i];
    try {
      const completion = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: options.maxTokens ?? 250,
        temperature: options.temperature ?? 0.7,
      }, {
        timeout: GROQ_TIMEOUT_MS
      });

      return completion.choices[0]?.message?.content?.trim() || "";
    } catch (error: any) {
      logger.warn(`LLM (non-stream): Groq Key ${i + 1} failed, switching...`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return "";
}
