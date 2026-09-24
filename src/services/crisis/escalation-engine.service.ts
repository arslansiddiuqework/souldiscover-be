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
 *  3. Build call context from session history
 *  4. Initiate Twilio call
 *  5. Save audit log
 *
 * NEVER throws. NEVER blocks the chat stream.
 */

import { EmotionAIResult }          from "../emotionAI.service";
import { assessCrisisRisk }          from "./crisis-detector.service";
import { EscalationCooldown }        from "./escalation-cooldown.service";
import { EscalationLogger }          from "./escalation-logger.service";
import { buildEmergencyCallContext } from "./escalation-memory.service";
import { EmergencyContact }          from "../../models/EmergencyContact";
import { EscalationLog }             from "../../models/EscalationLog";
import { initiateEmergencyCall }     from "../twilio/twilio-call.service";
import { initiateEmergencyWhatsApp } from "../twilio/twilio-whatsapp.service";
import { CrisisContext }             from "./crisis-types";
import { logger }                    from "../../utils/logger";

import { SystemSettingsService }     from "./settings.service";

// ── Main evaluate function ─────────────────────────────────────────────────────
export async function evaluate(
  userId:        string,
  sessionId:     string,
  userName:      string,
  emotionResult: EmotionAIResult,
  userMessage:   string
): Promise<void> {
  try {
    // ── Guard: system-wide switch ──────────────────────────────────────────────
    const settings = await SystemSettingsService.getSettings();
    if (!settings.crisisEnabled) return;
    // ── 1. Risk Assessment ─────────────────────────────────────────────────
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
      reason: assessment.escalationReason
    });

    EscalationLogger.crisisDetected({
      userId,
      sessionId,
      riskLevel:        assessment.riskLevel,
      riskScore:        assessment.crisisRiskScore,
      escalationReason: assessment.escalationReason,
    });

    // ── 2. Safety Gate: Session deduplication ──────────────────────────────
    if (EscalationCooldown.isSessionAlreadyEscalated(sessionId)) {
      EscalationLogger.escalationBlocked("session_duplicate", { userId, sessionId });
      return;
    }

    // ── 3. Safety Gate: User cooldown window ──────────────────────────────
    if (await EscalationCooldown.isOnCooldown(userId)) {
      EscalationLogger.escalationBlocked("cooldown", { userId, sessionId });
      return;
    }

    // ── 4. Safety Gate: Daily max escalations ─────────────────────────────
    if (await EscalationCooldown.isMaxPerDayReached(userId)) {
      EscalationLogger.escalationBlocked("max_per_day", { userId, sessionId });
      return;
    }

    // ── 5. Safety Gate: Consent + contacts ───────────────────────────────
    const contactRecord = await EmergencyContact.findOne({
      userId,
      consentAccepted: true,
      "escalationSettings.autoCallEnabled": true,
    });

    if (!contactRecord || !contactRecord.contacts.length) {
      EscalationLogger.escalationBlocked("no_contacts", { userId, sessionId });
      return;
    }

    const enabledContacts = contactRecord.contacts
      .filter((c) => c.enabled)
      .sort((a, b) => a.priority - b.priority);

    if (!enabledContacts.length) {
      EscalationLogger.escalationBlocked("no_enabled_contacts", { userId, sessionId });
      return;
    }

    const primaryContact = enabledContacts[0];

    // ── Mark session BEFORE async work (prevents race on rapid messages) ──
    EscalationCooldown.markSessionEscalated(sessionId);

    EscalationLogger.escalationTriggered({
      userId,
      sessionId,
      riskLevel:        assessment.riskLevel,
      riskScore:        assessment.crisisRiskScore,
      escalationReason: assessment.escalationReason,
      contactCalled:    primaryContact.name,
    });

    // ── 6. Build condensed call context (summarised, not raw history) ─────
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

    // ── 7. Pre-call audit log ─────────────────────────────────────────────
    const logEntry = await EscalationLog.create({
      userId,
      sessionId,
      riskLevel:        assessment.riskLevel,
      crisisRiskScore:  assessment.crisisRiskScore,
      escalationReason: assessment.escalationReason || "severe distress",
      contactCalled:    primaryContact.name,
      contactPhone:     primaryContact.phone,
      contactWhatsApp:  primaryContact.whatsappNumber,
      outcome:          "initiated",
    });

    // ── 8. Initiate Emergency Contact Methods ─────────────────────────────────
    const method = primaryContact.preferredContactMethod || "phone";
    logger.info(`[ESCALATION_ENGINE] Selected method: ${method}`);

    let callResult: any = { success: false, callSid: "", error: "" };
    let whatsappResult: any = { success: false, callSid: "", error: "" };

    const contactInfo = {
      name:         primaryContact.name,
      phone:        primaryContact.phone || "",
      whatsappNumber: primaryContact.whatsappNumber || "",
      relationship: primaryContact.relationship,
    };

    if (method === "phone" || method === "both") {
      logger.info("[TWILIO_CALL_ATTEMPT]", { userId, sessionId, contact: primaryContact.name });
      callResult = await initiateEmergencyCall(crisisContext, contactInfo);
    }

    if (method === "whatsapp" || method === "both") {
      whatsappResult = await initiateEmergencyWhatsApp(crisisContext, contactInfo as any);
    }

    // Determine overall success
    const success = (method === "both" && (callResult.success || whatsappResult.success)) ||
                    (method === "phone" && callResult.success) ||
                    (method === "whatsapp" && whatsappResult.success);

    const activeSid = callResult.callSid || whatsappResult.callSid;

    if (success && activeSid) {
      EscalationLogger.callStarted({
        userId,
        sessionId,
        callSid:       callResult.callSid,
        contactCalled: primaryContact.name,
      });
      await EscalationLog.findByIdAndUpdate(logEntry._id, {
        callSid: callResult.callSid,
      });
    } else {
      const combinedError = [callResult.error, whatsappResult.error].filter(Boolean).join(" | ");
      EscalationLogger.callFailed({
        userId,
        sessionId,
        contactCalled: primaryContact.name,
        error:         combinedError || "Unknown Twilio error",
      });
      await EscalationLog.findByIdAndUpdate(logEntry._id, {
        outcome: "failed",
        error:   combinedError,
      });
    }

  } catch (err) {
    // NEVER let escalation errors surface to the chat pipeline
    logger.error("[ESCALATION_ENGINE] Unhandled error — escalation aborted", {
      error: String(err),
      userId,
      sessionId,
    });
  }
}
