import { logger } from "../utils/logger";
import { generateStream, LLMResult } from "./llm.service";

export interface RouterResult {
  fullText: string;
  modelUsed: string;
  fallbackUsed: boolean;
  error?: boolean;
  errorCode?: LLMResult["errorCode"];
}

export async function routedGenerateStream(
  prompt: string,
  onChunk: (text: string) => void,
  options: {
    primaryMaxTokens?: number;
    temperature?: number;
  } = {},
  signal?: AbortSignal
): Promise<RouterResult> {
  logger.info("Router: delegating to OpenRouter free LLM");

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
    modelUsed: result.modelUsed,
    fallbackUsed: result.fallbackUsed,
    error: result.error,
    errorCode: result.errorCode,
  };
}
