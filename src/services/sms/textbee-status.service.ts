/**
 * TextBee delivery status sync (optional / authenticated polling only).
 *
 * Official send-sms docs treat HTTP 200 + smsBatchId as acceptance (queued).
 * Message-history filtering by smsBatchId is documented for later polling.
 * We do NOT expose an unauthenticated webhook endpoint: TextBee webhook
 * signature verification was not confirmed for this integration, so status
 * updates must use authenticated server-side polling when enabled.
 *
 * Docs: https://textbee.dev/docs/sending-sms/sending-sms
 */

import { EscalationLog } from "../../models/EscalationLog";
import { logger } from "../../utils/logger";
import type { EscalationDeliveryStatus } from "../../models/EscalationLog";

const DEFAULT_BASE = "https://api.textbee.dev/api/v1";

function getApiKey(): string {
  return (process.env.TEXTBEE_API_KEY || "").trim();
}

function getBaseUrl(): string {
  return (process.env.TEXTBEE_BASE_URL || DEFAULT_BASE).trim().replace(/\/+$/, "");
}

function mapProviderStatus(raw: unknown): EscalationDeliveryStatus {
  const s = String(raw || "").toLowerCase();
  if (s === "delivered") return "delivered";
  if (s === "sent" || s === "sending") return "sent";
  if (s === "failed" || s === "error") return "failed";
  if (s === "queued" || s === "pending") return "queued";
  return "unknown";
}

/**
 * Poll TextBee message history for a known smsBatchId and update EscalationLog.
 * Requires TEXTBEE_API_KEY. Never called from public webhooks.
 */
export async function syncTextBeeBatchStatus(
  smsBatchId: string
): Promise<{ ok: boolean; deliveryStatus?: EscalationDeliveryStatus; error?: string }> {
  if (!getApiKey()) {
    return { ok: false, error: "TEXTBEE_API_KEY not configured" };
  }
  if (!smsBatchId) {
    return { ok: false, error: "smsBatchId required" };
  }

  const url = `${getBaseUrl()}/gateway/messages?smsBatchId=${encodeURIComponent(smsBatchId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": getApiKey(),
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `TextBee status HTTP ${response.status}`,
      };
    }

    const body: any = await response.json().catch(() => null);
    const messages = body?.data?.messages || body?.data || body?.messages || [];
    const list = Array.isArray(messages) ? messages : [];

    if (!list.length) {
      return { ok: true, deliveryStatus: "queued" };
    }

    // Prefer worst-case among recipients (any failed → failed; else any delivered → delivered)
    const statuses = list.map((m: any) =>
      mapProviderStatus(m.status || m.deliveryStatus || m.state)
    );
    let deliveryStatus: EscalationDeliveryStatus = "queued";
    if (statuses.includes("failed")) deliveryStatus = "failed";
    else if (statuses.every((s: string) => s === "delivered"))
      deliveryStatus = "delivered";
    else if (statuses.includes("sent") || statuses.includes("delivered"))
      deliveryStatus = "sent";

    await EscalationLog.updateMany(
      { smsBatchId },
      {
        deliveryStatus,
        callStatus: deliveryStatus,
        outcome:
          deliveryStatus === "failed"
            ? "failed"
            : deliveryStatus === "delivered"
              ? "completed"
              : "initiated",
      }
    );

    logger.info("[SMS_TEXTBEE] status sync", { smsBatchId, deliveryStatus });
    return { ok: true, deliveryStatus };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, error: "status poll timed out" };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "status poll failed",
    };
  } finally {
    clearTimeout(timer);
  }
}
