/**
 * Crisis / emergency SMS orchestration on top of the modular SMS provider.
 */

import { CrisisContext } from "../crisis/crisis-types";
import { getSmsProvider } from "./sms.factory";
import type { SmsSendResult } from "./sms.types";
import { normalizeE164 } from "../../utils/phone";
import { logger } from "../../utils/logger";

export type EmergencyContactSmsInfo = {
  name: string;
  phone: string;
  relationship: string;
};

function buildEmergencySmsBody(
  ctx: CrisisContext,
  contact: EmergencyContactSmsInfo
): string {
  const risk = ctx.assessment?.riskLevel || "HIGH";
  const reason = (ctx.assessment?.escalationReason || "severe distress").slice(
    0,
    120
  );
  const summary = (ctx.emotionalSummary || "").slice(0, 220);
  const action = (ctx.recommendedAction || "Please check in with them soon.").slice(
    0,
    160
  );

  // Keep well under segment limits; no raw chat dump.
  return [
    `Soul Discovery alert (${risk})`,
    `For: ${contact.name} (${contact.relationship})`,
    `About: ${ctx.userName}`,
    `Reason: ${reason}`,
    summary ? `Context: ${summary}` : null,
    `Ask: ${action}`,
    `This is an automated wellness alert — not a medical diagnosis.`,
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 580);
}

export async function initiateEmergencySms(
  crisisContext: CrisisContext,
  contact: EmergencyContactSmsInfo
): Promise<SmsSendResult> {
  const provider = getSmsProvider();
  const phone = normalizeE164(contact.phone);

  if (!phone) {
    return {
      ok: false,
      provider: "textbee",
      error: "Contact phone is missing or not valid E.164.",
      code: "invalid_number",
    };
  }

  const message = buildEmergencySmsBody(crisisContext, contact);
  const idempotencyKey = `crisis:${crisisContext.sessionId}:${phone}`;

  logger.info("[EMERGENCY_SMS] initiating", {
    provider: provider.name,
    sessionId: crisisContext.sessionId,
    riskLevel: crisisContext.assessment?.riskLevel,
    contactName: contact.name,
  });

  return provider.sendSms({
    to: phone,
    message,
    idempotencyKey,
  });
}

export async function sendTestEmergencySms(
  contact: EmergencyContactSmsInfo,
  userName: string
): Promise<SmsSendResult> {
  const provider = getSmsProvider();
  const phone = normalizeE164(contact.phone);
  if (!phone) {
    return {
      ok: false,
      provider: "textbee",
      error: "Contact phone is missing or not valid E.164.",
      code: "invalid_number",
    };
  }

  const message = [
    `Soul Discovery test SMS`,
    `Hi ${contact.name}, this is a connectivity test from ${userName}'s wellness app.`,
    `No emergency — please ignore if unexpected.`,
  ]
    .join("\n")
    .slice(0, 400);

  return provider.sendSms({
    to: phone,
    message,
    idempotencyKey: `test:${Date.now()}`,
  });
}
