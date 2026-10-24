import type { SmsProvider } from "./sms.types";
import { textBeeSmsProvider } from "./textbee.provider";

/**
 * Resolve the active SMS provider from SMS_PROVIDER env.
 * Default: textbee.
 */
export function getSmsProvider(): SmsProvider {
  const name = (process.env.SMS_PROVIDER || "textbee").trim().toLowerCase();
  switch (name) {
    case "textbee":
    default:
      return textBeeSmsProvider;
  }
}

export function isSmsProviderConfigured(): boolean {
  return getSmsProvider().isConfigured();
}

export function isVoiceEscalationAvailable(): boolean {
  // TextBee is SMS-only (Android SIM). Voice calling is not supported.
  return false;
}
