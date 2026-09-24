/**
 * Twilio Call Service
 * ────────────────────
 * Places outbound emergency calls via Twilio REST API.
 * FAIL-SAFE: if Twilio is not configured, logs and returns gracefully.
 * Never throws — all errors are caught and returned as TwilioCallResult.
 */

import { logger }              from "../../utils/logger";
import { TwilioCallResult, EmergencyContactInfo } from "./twilio-types";
import { CrisisContext }       from "../crisis/crisis-types";
import { twilioSessionManager } from "./twilio-session-manager";
import { ActiveCallSession }   from "../crisis/crisis-types";

// ── Lazy Twilio Client ─────────────────────────────────────────────────────────
// Only initialised if env vars are present — prevents crash on missing config
let _client: any = null;

function getTwilioClient(): any | null {
  if (_client) return _client;

  const sid   = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token || sid === "AC_your_account_sid_here") {
    return null;
  }

  try {
    // Dynamic require so missing package doesn't crash server on startup
    const Twilio = require("twilio");
    _client = new Twilio(sid, token);
    logger.info("[TWILIO] Client initialised successfully");
    return _client;
  } catch (err) {
    logger.error("[TWILIO] Failed to initialise client", { error: String(err) });
    return null;
  }
}

// ── Main: Initiate Emergency Call ─────────────────────────────────────────────
export async function initiateEmergencyCall(
  crisisContext: CrisisContext,
  contact: EmergencyContactInfo
): Promise<TwilioCallResult> {
  const client = getTwilioClient();

  if (!client) {
    logger.info("[TWILIO_NOT_CONFIGURED] Skipping call", {
      userId:  crisisContext.userId,
      contact: contact.name,
    });
    return { success: false, error: "Twilio not configured" };
  }

  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const baseUrl    = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.BASE_URL || process.env.BACKEND_URL;

  if (!fromNumber || !baseUrl) {
    logger.error("[TWILIO] TWILIO_PHONE_NUMBER or BASE_URL missing");
    return { success: false, error: "Phone number or base URL not configured" };
  }

  // Encode context in query params — Twilio passes these back in the webhook
  const webhookParams = new URLSearchParams({
    userId:       crisisContext.userId,
    sessionId:    crisisContext.sessionId,
    contactName:  contact.name,
    relationship: contact.relationship,
  });

  const webhookUrl = `${baseUrl}/api/twilio/voice?${webhookParams.toString()}`;
  const statusUrl  = `${baseUrl}/api/twilio/voice/status`;

  if (baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1")) {
    logger.warn("[TWILIO_LOCAL_URL_WARNING] Webhook URL contains localhost. Twilio will not be able to reach this unless you are using ngrok and have configured BASE_URL correctly.", { baseUrl });
  }

  logger.info("[TWILIO_CALL_ATTEMPT]", {
    to: contact.phone,
    webhookUrl,
    statusCallback: statusUrl
  });

  try {
    const call = await client.calls.create({
      to:                   contact.phone,
      from:                 fromNumber,
      url:                  webhookUrl,
      statusCallback:       statusUrl,
      statusCallbackMethod: "POST",
      method:               "POST",
    });

    // Persist session so the voice controller can retrieve context
    const session: ActiveCallSession = {
      callSid:             call.sid,
      userId:              crisisContext.userId,
      sessionId:           crisisContext.sessionId,
      contactName:         contact.name,
      contactPhone:        contact.phone,
      crisisContext,
      conversationHistory: [],
      startedAt:           new Date(),
    };
    twilioSessionManager.set(call.sid, session);

    logger.info("[TWILIO_CALL_CREATED]", { callSid: call.sid, to: contact.phone });
    return { success: true, callSid: call.sid };

  } catch (err: any) {
    const msg = err?.message || String(err);
    logger.error("[CALL_FAILED]", { error: msg, contact: contact.name });
    return { success: false, error: msg };
  }
}
