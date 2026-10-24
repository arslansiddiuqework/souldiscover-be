/**
 * TextBee SMS provider (Android device gateway).
 * Docs: https://textbee.dev/docs/sending-sms/sending-sms
 *
 * Acceptance (HTTP 200 + smsBatchId) means QUEUED — not carrier delivery.
 */

import { logger } from "../../utils/logger";
import { normalizeE164, redactPhone } from "../../utils/phone";
import type { SmsProvider, SmsSendResult } from "./sms.types";

const DEFAULT_BASE = "https://api.textbee.dev/api/v1";
const MAX_MESSAGE_CHARS = 600;
const REQUEST_TIMEOUT_MS = 15_000;

function getApiKey(): string {
  return (process.env.TEXTBEE_API_KEY || "").trim();
}

function getBaseUrl(): string {
  const raw = (process.env.TEXTBEE_BASE_URL || DEFAULT_BASE).trim();
  return raw.replace(/\/+$/, "");
}

export class TextBeeSmsProvider implements SmsProvider {
  readonly name = "textbee";

  isConfigured(): boolean {
    return Boolean(getApiKey());
  }

  async sendSms(input: {
    to: string;
    message: string;
    idempotencyKey?: string;
  }): Promise<SmsSendResult> {
    if (!this.isConfigured()) {
      return {
        ok: false,
        provider: "textbee",
        error: "TextBee is not configured (TEXTBEE_API_KEY missing).",
        code: "not_configured",
      };
    }

    const to = normalizeE164(input.to);
    if (!to) {
      return {
        ok: false,
        provider: "textbee",
        error: "Recipient phone must be a valid E.164 number.",
        code: "invalid_number",
      };
    }

    const message = String(input.message || "").trim();
    if (!message) {
      return {
        ok: false,
        provider: "textbee",
        error: "Message text is required.",
        code: "invalid_message",
      };
    }
    if (message.length > MAX_MESSAGE_CHARS) {
      return {
        ok: false,
        provider: "textbee",
        error: `Message exceeds ${MAX_MESSAGE_CHARS} characters.`,
        code: "invalid_message",
      };
    }

    const url = `${getBaseUrl()}/gateway/send-sms`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    logger.info("[SMS_TEXTBEE] send attempt", {
      to: redactPhone(to),
      messageLength: message.length,
      idempotencyKey: input.idempotencyKey,
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": getApiKey(),
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          recipients: [to],
          message,
        }),
        signal: controller.signal,
      });

      const httpStatus = response.status;
      let body: any = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }

      if (httpStatus === 401) {
        return {
          ok: false,
          provider: "textbee",
          error: "TextBee API key is invalid or revoked.",
          code: "http_401",
          httpStatus,
        };
      }
      if (httpStatus === 429) {
        return {
          ok: false,
          provider: "textbee",
          error: "TextBee rate or plan limit exceeded.",
          code: "http_429",
          httpStatus,
        };
      }
      if (httpStatus === 400) {
        const detail =
          typeof body?.message === "string"
            ? body.message
            : typeof body?.error === "string"
              ? body.error
              : "TextBee rejected the request (no enabled device, unverified email, or push failure).";
        return {
          ok: false,
          provider: "textbee",
          error: detail.slice(0, 300),
          code: "http_400",
          httpStatus,
        };
      }
      if (!response.ok) {
        return {
          ok: false,
          provider: "textbee",
          error: `TextBee HTTP ${httpStatus}`,
          code: "unknown",
          httpStatus,
        };
      }

      const data = body?.data ?? body;
      const smsBatchId =
        typeof data?.smsBatchId === "string" ? data.smsBatchId : "";
      if (!smsBatchId) {
        return {
          ok: false,
          provider: "textbee",
          error: "TextBee response missing smsBatchId.",
          code: "malformed_response",
          httpStatus,
        };
      }

      logger.info("[SMS_TEXTBEE] accepted (queued)", {
        smsBatchId,
        recipientCount: data?.recipientCount,
        warningCode: data?.warning?.code,
      });

      return {
        ok: true,
        provider: "textbee",
        smsBatchId,
        status: "queued",
        recipientCount:
          typeof data?.recipientCount === "number"
            ? data.recipientCount
            : 1,
        warningCode: data?.warning?.code,
        warningMessage: data?.warning?.message,
        rawMessage:
          typeof data?.message === "string" ? data.message : undefined,
      };
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return {
          ok: false,
          provider: "textbee",
          error: "TextBee request timed out.",
          code: "timeout",
        };
      }
      logger.warn("[SMS_TEXTBEE] network error", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        ok: false,
        provider: "textbee",
        error: "Network error contacting TextBee.",
        code: "network",
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const textBeeSmsProvider = new TextBeeSmsProvider();
