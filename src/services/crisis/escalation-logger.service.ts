/**
 * Escalation Logger Service
 * ─────────────────────────
 * Centralised structured logging for all crisis events.
 * All log entries include userId, sessionId, timestamp.
 */

import { logger } from "../../utils/logger";
import { RiskLevel } from "./crisis-types";

interface BasePayload {
  userId: string;
  sessionId?: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
  escalationReason?: string;
  contactCalled?: string;
  callSid?: string;
  [key: string]: unknown;
}

function stamp(payload: BasePayload) {
  return { ...payload, timestamp: new Date().toISOString() };
}

export const EscalationLogger = {
  crisisDetected(payload: BasePayload) {
    logger.warn("[CRISIS_DETECTED]", stamp(payload));
  },

  escalationTriggered(payload: BasePayload) {
    logger.warn("[ESCALATION_TRIGGERED]", stamp(payload));
  },

  escalationBlocked(reason: string, payload: BasePayload) {
    logger.info(`[ESCALATION_BLOCKED:${reason.toUpperCase()}]`, stamp(payload));
  },

  callStarted(payload: BasePayload) {
    logger.info("[CALL_STARTED]", stamp(payload));
  },

  callConnected(payload: BasePayload) {
    logger.info("[CALL_CONNECTED]", stamp(payload));
  },

  callCompleted(payload: BasePayload) {
    logger.info("[CALL_COMPLETED]", stamp(payload));
  },

  callFailed(payload: BasePayload & { error: string }) {
    logger.error("[CALL_FAILED]", stamp(payload));
  },

  twilioNotConfigured(payload: BasePayload) {
    logger.info("[TWILIO_NOT_CONFIGURED]", stamp(payload));
  },
};
