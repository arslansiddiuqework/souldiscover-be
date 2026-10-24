/**
 * OpenRouter free-model LLM client.
 *
 * - Uses only free models (default: openrouter/free).
 * - Never configures paid models in fallback lists.
 * - API key stays server-side only.
 */

import { logger } from "../utils/logger";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_TOKENS = 250;

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  /** When true, send system+user as separate chat messages if prompt is flat. */
  system?: string;
}

export interface LLMResult {
  fullText: string;
  modelUsed: string;
  fallbackUsed: boolean;
  error?: boolean;
  errorCode?:
    | "missing_key"
    | "invalid_model"
    | "unavailable"
    | "rate_limited"
    | "provider_error"
    | "timeout"
    | "network";
}

export class LLMProviderError extends Error {
  code: NonNullable<LLMResult["errorCode"]>;
  status?: number;

  constructor(
    code: NonNullable<LLMResult["errorCode"]>,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "LLMProviderError";
    this.code = code;
    this.status = status;
  }
}

/** True only for OpenRouter free router or explicit :free variants. */
export function isFreeOpenRouterModel(model: string): boolean {
  const id = (model || "").trim().toLowerCase();
  if (!id) return false;
  if (id === "openrouter/free") return true;
  return id.endsWith(":free");
}

/**
 * Free models that are classifiers/moderators — not chat companions.
 * openrouter/free sometimes picks these and returns "User Safety: safe".
 */
export function isNonConversationalFreeModel(model: string): boolean {
  const id = (model || "").trim().toLowerCase();
  if (!id) return false;
  return (
    id.includes("content-safety") ||
    id.includes("moderation") ||
    id.includes("guardrail") ||
    id.includes("prompt-guard") ||
    /nemotron.*safety/.test(id) ||
    /safety.*nemotron/.test(id)
  );
}

/** Classifier-style replies that must never be shown as wellness chat. */
export function looksLikeSafetyClassifierOutput(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return true;
  if (/^user\s*safety\s*:/i.test(t)) return true;
  if (/^(safe|unsafe)\b/i.test(t) && t.length < 40) return true;
  if (/safety\s*:\s*(safe|unsafe)/i.test(t) && t.length < 100) return true;
  if (/^response\s*safety\s*:/i.test(t)) return true;
  return false;
}

/**
 * Curated free *chat* models only (no paid, no content-safety).
 * Ordered by recent live reliability. OpenRouter allows at most 3 entries
 * in the `models` fallback array (primary is separate).
 */
export const FREE_CHAT_MODELS = [
  "poolside/laguna-s-2.1:free",
  "dots-studio/dots-3-note-preview:free",
  "liquid/lfm-2.5-2.6b:free",
  "google/gemma-4-31b-it:free",
  "poolside/laguna-xs-2.1:free",
];

/** OpenRouter hard limit on the `models` fallback array length. */
const OPENROUTER_MODELS_FALLBACK_MAX = 3;

export function getConfiguredModel(): string {
  return (process.env.OPENROUTER_MODEL || "openrouter/free").trim();
}

export function assertFreeModelConfig(model = getConfiguredModel()): string {
  if (!isFreeOpenRouterModel(model)) {
    throw new LLMProviderError(
      "invalid_model",
      "Only free OpenRouter models are allowed (openrouter/free or *:free)."
    );
  }
  if (isNonConversationalFreeModel(model)) {
    throw new LLMProviderError(
      "invalid_model",
      "Content-safety / moderation models cannot be used for chat."
    );
  }
  return model;
}

/** Models that would be sent on a request — must all be free chat models. */
export function assertAllModelsFree(models: string[]): void {
  for (const m of models) {
    if (!isFreeOpenRouterModel(m)) {
      throw new LLMProviderError(
        "invalid_model",
        `Refusing paid or unknown model in request list: ${m}`
      );
    }
    if (isNonConversationalFreeModel(m)) {
      throw new LLMProviderError(
        "invalid_model",
        `Refusing non-conversational free model: ${m}`
      );
    }
  }
}

/**
 * Build the free-only model list for a chat request.
 * openrouter/free → curated free chat models (avoids safety classifiers).
 * Caps `models` to OpenRouter's max of 3 fallbacks.
 */
export function getFreeChatModelRequestIds(): {
  model: string;
  models?: string[];
} {
  const configured = assertFreeModelConfig();

  const primary =
    configured === "openrouter/free" ? FREE_CHAT_MODELS[0] : configured;
  const fallbacks = FREE_CHAT_MODELS.filter((m) => m !== primary).slice(
    0,
    OPENROUTER_MODELS_FALLBACK_MAX
  );

  assertAllModelsFree([primary, ...fallbacks]);
  return {
    model: primary,
    models: fallbacks.length ? fallbacks : undefined,
  };
}

/** Ordered free chat candidates for client-side sequential retries. */
export function getFreeChatCandidates(): string[] {
  const configured = assertFreeModelConfig();
  if (configured === "openrouter/free") {
    return [...FREE_CHAT_MODELS];
  }
  return [
    configured,
    ...FREE_CHAT_MODELS.filter((m) => m !== configured),
  ];
}

function getApiKey(): string {
  return (process.env.OPENROUTER_API_KEY || "").trim();
}

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${getApiKey()}`,
    "Content-Type": "application/json",
  };
  const referer =
    process.env.OPENROUTER_HTTP_REFERER ||
    process.env.FRONTEND_URL ||
    "https://souldiscovery.app";
  const title = process.env.OPENROUTER_APP_TITLE || "Soul Discovery";
  headers["HTTP-Referer"] = referer;
  headers["X-OpenRouter-Title"] = title;
  return headers;
}

function friendlyUnavailable(): string {
  return "Free AI chat is temporarily unavailable. Please try again in a little while.";
}

function friendlyRateLimited(): string {
  return "The free AI service is busy right now. Please wait a moment and try again.";
}

function mapHttpError(status: number, bodyText: string): LLMProviderError {
  const lower = bodyText.toLowerCase();
  if (status === 429) {
    return new LLMProviderError(
      "rate_limited",
      friendlyRateLimited(),
      status
    );
  }
  if (
    status === 404 ||
    lower.includes("no endpoints") ||
    lower.includes("not found") ||
    lower.includes("no free")
  ) {
    return new LLMProviderError(
      "unavailable",
      friendlyUnavailable(),
      status
    );
  }
  if (status === 401 || status === 403) {
    return new LLMProviderError(
      "provider_error",
      friendlyUnavailable(),
      status
    );
  }
  if (status >= 500) {
    return new LLMProviderError(
      "provider_error",
      friendlyUnavailable(),
      status
    );
  }
  return new LLMProviderError(
    "provider_error",
    friendlyUnavailable(),
    status
  );
}

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function toMessages(prompt: string, options: LLMOptions): ChatMessage[] {
  if (options.system) {
    return [
      { role: "system", content: options.system },
      { role: "user", content: prompt },
    ];
  }
  return [{ role: "user", content: prompt }];
}

function createTimeoutSignal(
  timeoutMs: number,
  outer?: AbortSignal
): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onOuterAbort, { once: true });
  }

  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      if (outer) outer.removeEventListener("abort", onOuterAbort);
    },
  };
}

async function streamOpenRouterOnce(
  prompt: string,
  route: { model: string; models?: string[] },
  options: LLMOptions,
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<LLMResult> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const temperature = options.temperature ?? 0.7;
  const timeout = createTimeoutSignal(DEFAULT_TIMEOUT_MS, signal);

  try {
    assertAllModelsFree([route.model, ...(route.models || [])]);
    logger.info("LLM: OpenRouter free stream starting", {
      model: route.model,
      fallbacks: route.models?.length ?? 0,
      maxTokens,
    });

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        model: route.model,
        ...(route.models?.length ? { models: route.models } : {}),
        messages: toMessages(prompt, options),
        max_tokens: maxTokens,
        temperature,
        stream: true,
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      logger.warn("LLM: OpenRouter HTTP error", {
        status: response.status,
        bodyLength: bodyText.length,
      });
      throw mapHttpError(response.status, bodyText);
    }

    if (!response.body) {
      throw new LLMProviderError("provider_error", friendlyUnavailable());
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";
    let resolvedModel = route.model;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";

      for (const rawLine of parts) {
        const line = rawLine.trim();
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data:")) continue;

        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;

        let parsed: {
          model?: string;
          choices?: Array<{
            delta?: { content?: string | null };
          }>;
          error?: { message?: string; code?: number };
        };
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }

        if (parsed.error) {
          throw mapHttpError(
            parsed.error.code || 500,
            parsed.error.message || ""
          );
        }

        if (parsed.model) {
          if (!isFreeOpenRouterModel(parsed.model)) {
            logger.error("LLM: refusing non-free model in response", {
              model: parsed.model,
            });
            throw new LLMProviderError("invalid_model", friendlyUnavailable());
          }
          if (isNonConversationalFreeModel(parsed.model)) {
            logger.warn("LLM: free router picked a non-chat model", {
              model: parsed.model,
            });
            throw new LLMProviderError("unavailable", friendlyUnavailable());
          }
          resolvedModel = parsed.model;
        }

        const content = parsed.choices?.[0]?.delta?.content || "";
        if (content) {
          fullText += content;
        }
      }
    }

    if (!fullText.trim()) {
      throw new LLMProviderError("unavailable", friendlyUnavailable());
    }

    if (looksLikeSafetyClassifierOutput(fullText)) {
      logger.warn("LLM: rejecting safety-classifier style reply", {
        model: resolvedModel,
        length: fullText.length,
      });
      throw new LLMProviderError("unavailable", friendlyUnavailable());
    }

    // Emit only after validation so bad free-router picks never hit the UI,
    // and retries can run without the user seeing "User Safety: safe".
    onChunk(fullText);

    logger.info("LLM: OpenRouter free stream succeeded", {
      model: resolvedModel,
      length: fullText.length,
    });

    return {
      fullText,
      modelUsed: resolvedModel,
      fallbackUsed: false,
    };
  } finally {
    timeout.clear();
  }
}

function isRetryableProviderFailure(error: unknown): boolean {
  if (!(error instanceof LLMProviderError)) {
    const aborted =
      (error as { name?: string })?.name === "AbortError" ||
      String((error as Error)?.message || "")
        .toLowerCase()
        .includes("abort");
    return !aborted; // network/unknown → retry once; abort/timeout → no
  }
  return (
    error.code === "unavailable" ||
    error.code === "provider_error" ||
    error.code === "rate_limited"
  );
}

/**
 * Streaming completion via OpenRouter chat/completions (SSE).
 * Re-emits text deltas through onChunk. Never falls back to paid models.
 * Retries once on empty/unavailable free-router responses (still free-only).
 */
export async function generateStream(
  prompt: string,
  onChunk: (text: string) => void,
  options: LLMOptions = {},
  signal?: AbortSignal
): Promise<LLMResult> {
  if (!getApiKey()) {
    const msg = friendlyUnavailable();
    onChunk(msg);
    return {
      fullText: msg,
      modelUsed: getConfiguredModel(),
      fallbackUsed: false,
      error: true,
      errorCode: "missing_key",
    };
  }

  let model: string;
  try {
    model = assertFreeModelConfig();
  } catch (err) {
    const msg =
      err instanceof LLMProviderError ? err.message : friendlyUnavailable();
    onChunk(msg);
    return {
      fullText: msg,
      modelUsed: getConfiguredModel(),
      fallbackUsed: false,
      error: true,
      errorCode: "invalid_model",
    };
  }

  // Rotate free chat primaries on failure (still never paid / never safety models).
  const candidates = getFreeChatCandidates();
  const maxAttempts = Math.min(3, candidates.length);
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const primary = candidates[attempt];
    const fallbacks = candidates
      .filter((m) => m !== primary)
      .slice(0, OPENROUTER_MODELS_FALLBACK_MAX);
    const route = { model: primary, models: fallbacks };
    let streamedAny = false;

    try {
      const result = await streamOpenRouterOnce(
        prompt,
        route,
        options,
        (text) => {
          streamedAny = true;
          onChunk(text);
        },
        signal
      );

      return {
        ...result,
        fallbackUsed: attempt > 0,
      };
    } catch (error: unknown) {
      lastError = error;
      const canRetry =
        attempt < maxAttempts - 1 &&
        !streamedAny &&
        isRetryableProviderFailure(error) &&
        !(signal?.aborted);

      if (canRetry) {
        logger.warn("LLM: free chat attempt failed, trying next free model", {
          attempt: attempt + 1,
          model: primary,
          code: error instanceof LLMProviderError ? error.code : "network",
        });
        await new Promise((r) => setTimeout(r, 300));
        continue;
      }
      break;
    }
  }

  const error = lastError;
  if (error instanceof LLMProviderError) {
    logger.warn("LLM: provider error", {
      code: error.code,
      status: error.status,
    });
    onChunk(error.message);
    return {
      fullText: error.message,
      modelUsed: model,
      fallbackUsed: true,
      error: true,
      errorCode: error.code,
    };
  }

  const aborted =
    (error as { name?: string })?.name === "AbortError" ||
    String((error as Error)?.message || "")
      .toLowerCase()
      .includes("abort");

  if (aborted) {
    const msg = friendlyRateLimited();
    onChunk(msg);
    return {
      fullText: msg,
      modelUsed: model,
      fallbackUsed: true,
      error: true,
      errorCode: "timeout",
    };
  }

  logger.error("LLM: network/unknown failure", {
    error: error instanceof Error ? error.message : String(error),
  });
  const msg = friendlyUnavailable();
  onChunk(msg);
  return {
    fullText: msg,
    modelUsed: model,
    fallbackUsed: true,
    error: true,
    errorCode: "network",
  };
}

/**
 * Non-streaming generation for background tasks (titles, summaries).
 * Returns empty string on failure (non-critical callers).
 */
export async function generate(
  prompt: string,
  options: LLMOptions = {}
): Promise<string> {
  if (!getApiKey()) return "";

  let route: ReturnType<typeof getFreeChatModelRequestIds>;
  try {
    route = getFreeChatModelRequestIds();
    assertAllModelsFree([route.model, ...(route.models || [])]);
  } catch {
    return "";
  }

  const timeout = createTimeoutSignal(DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify({
        model: route.model,
        ...(route.models?.length ? { models: route.models } : {}),
        messages: toMessages(prompt, options),
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? 0.7,
        stream: false,
      }),
      signal: timeout.signal,
    });

    if (!response.ok) {
      logger.warn("LLM (non-stream): OpenRouter HTTP error", {
        status: response.status,
      });
      return "";
    }

    const data = (await response.json()) as {
      model?: string;
      choices?: Array<{ message?: { content?: string | null } }>;
    };

    if (data.model && !isFreeOpenRouterModel(data.model)) {
      logger.error("LLM (non-stream): refusing non-free model", {
        model: data.model,
      });
      return "";
    }
    if (data.model && isNonConversationalFreeModel(data.model)) {
      return "";
    }

    const text = data.choices?.[0]?.message?.content?.trim() || "";
    if (looksLikeSafetyClassifierOutput(text)) return "";
    return text;
  } catch (error) {
    logger.warn("LLM (non-stream): failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "";
  } finally {
    timeout.clear();
  }
}

/** Exported for tests — builds the request body that would be sent. */
export function buildChatCompletionsBody(
  prompt: string,
  options: LLMOptions = {}
): Record<string, unknown> {
  const route = getFreeChatModelRequestIds();
  assertAllModelsFree([route.model, ...(route.models || [])]);
  return {
    model: route.model,
    ...(route.models?.length ? { models: route.models } : {}),
    messages: toMessages(prompt, options),
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? 0.7,
  };
}
