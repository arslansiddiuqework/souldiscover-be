/**
 * Escalation Engine Service
 * ──────────────────────────
 * The ONLY entry point for the entire crisis escalation pipeline.
 * Called from chat.ts as a fire-and-forget background task:
 *   void escalationEngine.evaluate(...)
 *
 * Flow:
 *  1. Assess crisis risk (from existing emotion result)
 *  2. Check all safety gates (cooldown, session dedup, consent, contacts)
 *  3. Build condensed SMS context from session history
 *  4. Send emergency SMS via TextBee (voice is not available)
 *  5. Save audit log
 *
 * NEVER throws. NEVER blocks the chat stream.
 */

import { EmotionAIResult } from "../emotionAI.service";
import { assessCrisisRisk } from "./crisis-detector.service";
import { EscalationCooldown } from "./escalation-cooldown.service";
import { EscalationLogger } from "./escalation-logger.service";
import { buildEmergencyCallContext } from "./escalation-memory.service";
import { EmergencyContact } from "../../models/EmergencyContact";
import { EscalationLog } from "../../models/EscalationLog";
import { initiateEmergencySms } from "../sms/emergency-sms.service";
import {
  getSmsProvider,
  isSmsProviderConfigured,
  isVoiceEscalationAvailable,
} from "../sms/sms.factory";
import { CrisisContext } from "./crisis-types";
import { logger } from "../../utils/logger";
import { normalizeE164, redactPhone } from "../../utils/phone";
import { SystemSettingsService } from "./settings.service";

export async function evaluate(
  userId: string,
  sessionId: string,
  userName: string,
  emotionResult: EmotionAIResult,
  userMessage: string
): Promise<void> {
  try {
    const settings = await SystemSettingsService.getSettings();
    if (!settings.crisisEnabled) return;

    const assessment = assessCrisisRisk(emotionResult, userMessage);

    const shouldEscalate =
      assessment.riskLevel === "HIGH" ||
      assessment.riskLevel === "CRITICAL" ||
      assessment.escalationRecommended;

    if (!shouldEscalate) {
      logger.debug("[ESCALATION_ENGINE] No escalation needed", {
        riskLevel: assessment.riskLevel,
        userId,
      });
      return;
    }

    logger.info("[ESCALATION_TRIGGERED]", {
      userId,
      sessionId,
      riskLevel: assessment.riskLevel,
      reason: assessment.escalationReason,
    });

    EscalationLogger.crisisDetected({
      userId,
      sessionId,
      riskLevel: assessment.riskLevel,
      riskScore: assessment.crisisRiskScore,
      escalationReason: assessment.escalationReason,
    });

    if (EscalationCooldown.isSessionAlreadyEscalated(sessionId)) {
      EscalationLogger.escalationBlocked("session_duplicate", {
        userId,
        sessionId,
      });
      return;
    }

    if (await EscalationCooldown.isOnCooldown(userId)) {
      EscalationLogger.escalationBlocked("cooldown", { userId, sessionId });
      return;
    }

    if (await EscalationCooldown.isMaxPerDayReached(userId)) {
      EscalationLogger.escalationBlocked("max_per_day", {
        userId,
        sessionId,
      });
      return;
    }

    const contactRecord = await EmergencyContact.findOne({
      userId,
      consentAccepted: true,
      "escalationSettings.autoCallEnabled": true,
    });

    if (!contactRecord || !contactRecord.contacts.length) {
      EscalationLogger.escalationBlocked("no_contacts", {
        userId,
        sessionId,
      });
      return;
    }

    const enabledContacts = contactRecord.contacts
      .filter((c) => c.enabled)
      .sort((a, b) => a.priority - b.priority);

    if (!enabledContacts.length) {
      EscalationLogger.escalationBlocked("no_enabled_contacts", {
        userId,
        sessionId,
      });
      return;
    }

    const primaryContact = enabledContacts[0];
    const smsPhone =
      normalizeE164(primaryContact.phone) ||
      normalizeE164((primaryContact as any).whatsappNumber);

    if (!smsPhone) {
      EscalationLogger.escalationBlocked("invalid_phone", {
        userId,
        sessionId,
        contactCalled: primaryContact.name,
      });
      return;
    }

    if (!isSmsProviderConfigured()) {
      EscalationLogger.smsNotConfigured({ userId, sessionId });
      await EscalationLog.create({
        userId,
        sessionId,
        riskLevel: assessment.riskLevel,
        crisisRiskScore: assessment.crisisRiskScore,
        escalationReason: assessment.escalationReason || "severe distress",
        contactCalled: primaryContact.name,
        contactPhone: smsPhone,
        channel: "sms",
        provider: getSmsProvider().name,
        voiceStatus: "VOICE_UNAVAILABLE",
        outcome: "failed",
        deliveryStatus: "failed",
        error: "SMS provider not configured (TEXTBEE_API_KEY missing).",
      });
      return;
    }

    // Mark session BEFORE async work (prevents race on rapid messages)
    EscalationCooldown.markSessionEscalated(sessionId);

    EscalationLogger.escalationTriggered({
      userId,
      sessionId,
      riskLevel: assessment.riskLevel,
      riskScore: assessment.crisisRiskScore,
      escalationReason: assessment.escalationReason,
      contactCalled: primaryContact.name,
    });

    const emotionalSummary = await buildEmergencyCallContext(sessionId, userId);

    const crisisContext: CrisisContext = {
      userId,
      sessionId,
      userName,
      assessment,
      emotionalSummary,
      triggeringStatements: [userMessage.slice(0, 200)],
      recommendedAction:
        assessment.recommendedAction ||
        "Please reach out to this person and offer your support immediately.",
    };

    const preferred = primaryContact.preferredContactMethod || "phone";
    // Historical "phone" meant voice. Voice is not supported by TextBee.
    const requestedVoice = preferred === "phone" || preferred === "both";
    const voiceStatus = isVoiceEscalationAvailable()
      ? "available"
      : "VOICE_UNAVAILABLE";

    const logEntry = await EscalationLog.create({
      userId,
      sessionId,
      riskLevel: assessment.riskLevel,
      crisisRiskScore: assessment.crisisRiskScore,
      escalationReason: assessment.escalationReason || "severe distress",
      contactCalled: primaryContact.name,
      contactPhone: smsPhone,
      contactWhatsApp: primaryContact.whatsappNumber,
      channel: "sms",
      provider: getSmsProvider().name,
      voiceStatus,
      outcome: "initiated",
      deliveryStatus: "pending",
      error: requestedVoice
        ? "Voice calling is not configured; sending SMS instead."
        : undefined,
    });

    logger.info("[ESCALATION_ENGINE] Sending emergency SMS", {
      provider: getSmsProvider().name,
      preferredMethod: preferred,
      voiceStatus,
      contact: primaryContact.name,
      to: redactPhone(smsPhone),
    });

    const smsResult = await initiateEmergencySms(crisisContext, {
      name: primaryContact.name,
      phone: smsPhone,
      relationship: primaryContact.relationship,
    });

    if (smsResult.ok) {
      EscalationLogger.smsQueued({
        userId,
        sessionId,
        smsBatchId: smsResult.smsBatchId,
        contactCalled: primaryContact.name,
      });
      await EscalationLog.findByIdAndUpdate(logEntry._id, {
        smsBatchId: smsResult.smsBatchId,
        deliveryStatus: smsResult.status,
        // HTTP acceptance ≠ carrier delivery
        outcome: "initiated",
        callStatus: smsResult.status,
        error: requestedVoice
          ? "Voice calling is not configured; SMS accepted by provider (queued)."
          : smsResult.warningMessage || undefined,
      });
    } else {
      EscalationLogger.smsFailed({
        userId,
        sessionId,
        contactCalled: primaryContact.name,
        error: smsResult.error,
        code: smsResult.code,
      });
      await EscalationLog.findByIdAndUpdate(logEntry._id, {
        outcome: "failed",
        deliveryStatus: "failed",
        error: smsResult.error,
        providerErrorCode: smsResult.code,
      });
    }
  } catch (err) {
    logger.error("[ESCALATION_ENGINE] Unhandled error — escalation aborted", {
      error: String(err),
      userId,
      sessionId,
    });
  }
}
