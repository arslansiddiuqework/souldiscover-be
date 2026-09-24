import { logger } from "../utils/logger";
import { generateStream } from "./llm.service";

// Router Result
export interface RouterResult {
  fullText: string;
  modelUsed: "groq";
  fallbackUsed: boolean;
  error?: boolean;
}

// Main Router
export async function routedGenerateStream(
  prompt: string,
  onChunk: (text: string) => void,
  options: {
    primaryMaxTokens?: number;
    temperature?: number;
  } = {},
  signal?: AbortSignal
): Promise<RouterResult> {
  logger.info("🚀 Router: delegating to LLM Service");

  const result = await generateStream(
    prompt,
    onChunk,
    {
      maxTokens: options.primaryMaxTokens ?? 250,
      temperature: options.temperature ?? 0.7,
    },
    signal
  );

  return {
    fullText: result.fullText,
    modelUsed: result.modelUsed as "groq",
    fallbackUsed: result.fallbackUsed,
    error: result.error
  };
}
