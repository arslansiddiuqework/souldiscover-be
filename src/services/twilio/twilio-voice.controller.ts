/**
 * Twilio Voice Controller
 * ───────────────────────
 * Handles three webhook routes called by Twilio during emergency calls:
 *
 *  POST /api/twilio/voice          — Call connects → return opening TwiML
 *  POST /api/twilio/voice/respond  — Contact speaks → Groq AI reply → TwiML
 *  POST /api/twilio/voice/status   — Call status updates → update EscalationLog
 *
 * All responses are TwiML XML. Groq is called via the EXISTING generate() fn.
 */

import { Request, Response }        from "express";
import { twilioSessionManager }      from "./twilio-session-manager";
import { buildCallResponsePrompt, buildOpeningMessage } from "../../prompts/emergency-contact.prompt";
import { buildGreetingTwiML, buildResponseTwiML, buildErrorTwiML, buildClosingTwiML } from "./twiml-builder";
import { buildEmergencyCallContext }                    from "../crisis/escalation-memory.service";
import { generate }                                     from "../llm.service";
import { EscalationLog }                               from "../../models/EscalationLog";
import { EscalationLogger }                            from "../crisis/escalation-logger.service";
import { logger }                                       from "../../utils/logger";
import { CrisisContext, CrisisAssessment }              from "../crisis/crisis-types";

// ── Helper: send TwiML response ────────────────────────────────────────────────
function sendTwiML(res: Response, twiml: string): void {
  res.set("Content-Type", "text/xml");
  res.send(twiml);
}

// ── POST /api/twilio/voice — Initial webhook (call connected) ──────────────────
export const handleVoiceWebhook = async (req: Request, res: Response): Promise<void> => {
  const timestamp = new Date().toISOString();
  const sessionId = (req.query.sessionId as string) || "unknown";
  
  logger.info("[TWILIO_WEBHOOK_HIT]", { 
    path: "/api/twilio/voice",
    sessionId, 
    timestamp,
    method: req.method,
    query: req.query,
    body: req.body 
  });

  try {
    const callSid      = req.body?.CallSid || (req.query.callSid as string);
    const userId       = (req.query.userId as string) || "";
    const contactName  = (req.query.contactName as string) || "there";
    const userName     = (req.query.userName as string) || "someone";
    const riskLevel    = (req.query.riskLevel as string) || "HIGH";

    // 1. Respond IMMEDIATELY with Bridge TwiML to stabilize call
    const baseUrl = process.env.TWILIO_WEBHOOK_BASE_URL || process.env.BASE_URL;
    const introUrl = `${baseUrl}/api/twilio/voice/intro?callSid=${encodeURIComponent(callSid)}&userId=${encodeURIComponent(userId)}&sessionId=${encodeURIComponent(sessionId)}&contactName=${encodeURIComponent(contactName)}&userName=${encodeURIComponent(userName)}&riskLevel=${encodeURIComponent(riskLevel)}`;

    const bridgeTwiML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="alice">This is an emergency call from Soul Discovery. Please stay on the line.</Say>
  <Redirect method="POST">${introUrl.replace(/&/g, "&amp;")}</Redirect>
</Response>`;

    res.type("text/xml");
    res.send(bridgeTwiML);
    
    logger.info("[TWILIO_TWIML_SENT]", { 
      sessionId, 
      type: "bridge",
      twiml: bridgeTwiML 
    });

    // 2. Background work: Ensure session is initialized
    let callSession = await twilioSessionManager.get(callSid);
    if (!callSession && userId) {
      const assessment: CrisisAssessment = {
        riskLevel: (riskLevel as any) || "HIGH",
        crisisRiskScore: 0.8,
        suicideRisk: 0, selfHarmRisk: 0, panicSeverity: 0,
        escalationRecommended: true, confidence: 0.7,
        escalationReason: "severe emotional distress",
        recommendedAction: "Please check on this person immediately",
      };

      await twilioSessionManager.set(callSid, {
        callSid, userId, sessionId,
        contactName, contactPhone: "",
        crisisContext: {
          userId, sessionId, userName,
          assessment,
          emotionalSummary: "Initial handshake in progress...",
          triggeringStatements: [],
          recommendedAction: assessment.recommendedAction!,
        },
        conversationHistory: [],
        startedAt: new Date(),
      });
    }

  } catch (err) {
    logger.error("[WEBHOOK_EXCEPTION]", { error: String(err), sessionId });
    res.type("text/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?><Response><Say>Emergency system activated. Please hold.</Say></Response>`);
  }
};

// ── POST /api/twilio/voice/intro — Secondary webhook (play real greeting) ────────
export const handleVoiceIntro = async (req: Request, res: Response): Promise<void> => {
  const sessionId = (req.query.sessionId as string) || "unknown";
  logger.info("[TWILIO_WEBHOOK_HIT]", { path: "/api/twilio/voice/intro", sessionId });

  try {
    const callSid     = (req.query.callSid || req.body?.CallSid) as string;
    const contactName = (req.query.contactName as string) || "there";
    const userName    = (req.query.userName as string) || "someone";

    const callSession = await twilioSessionManager.get(callSid);
    
    if (!callSession) {
      const twiml = buildClosingTwiML("Hello, we are calling regarding a wellness concern for " + userName + ". Please reach out to them. Goodbye.");
      res.type("text/xml");
      res.send(twiml);
      return;
    }

    const opening = buildOpeningMessage(contactName, userName, callSession.crisisContext);
    
    await twilioSessionManager.update(callSid, {
      conversationHistory: [{ role: "ai", content: opening }],
    });

    const twiml = buildGreetingTwiML(contactName, userName, opening, callSid);
    res.type("text/xml");
    res.send(twiml);
    
    logger.info("[TWILIO_CALL_ACTIVE]", { sessionId, twiml });

    // Optional: Kick off background context building
    if (callSession.crisisContext.emotionalSummary.includes("handshake")) {
       void buildEmergencyCallContext(callSession.sessionId, callSession.userId).then(async summary => {
         await twilioSessionManager.update(callSid, {
           crisisContext: { ...callSession.crisisContext, emotionalSummary: summary }
         });
       });
    }

  } catch (err) {
    logger.error("[WEBHOOK_EXCEPTION]", { error: String(err), path: "/intro" });
    res.type("text/xml");
    res.send(buildErrorTwiML());
  }
};

// ── GET /api/twilio/debug — Dedicated Twilio debug route ───────────────────────
export const handleDebug = async (req: Request, res: Response): Promise<void> => {
  logger.info("[TWILIO_DEBUG_HIT]", { query: req.query });
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Soul Discovery Twilio Debug Route is working correctly. This is a test message to verify XML parsing and connectivity. One. Two. Three. Success.</Say>
  <Pause length="2"/>
  <Say voice="alice">If you can hear this, your webhook configuration is valid. Goodbye.</Say>
  <Hangup/>
</Response>`;
  res.type("text/xml");
  res.send(twiml);
};

// ── POST /api/twilio/voice/respond — Contact spoke, generate AI reply ──────────
export const handleVoiceRespond = async (req: Request, res: Response): Promise<void> => {
  const callSid = (req.query.callSid || req.body?.CallSid) as string;
  logger.info("[TWILIO_WEBHOOK_HIT]", { path: "/api/twilio/voice/respond", callSid });

  try {
    const speechResult = (req.body?.SpeechResult || "").trim();
    logger.info("[TWILIO_CONTACT_SPOKE]", { callSid, speech: speechResult.slice(0, 80) });

    const callSession = await twilioSessionManager.get(callSid);

    if (!callSession) {
      const twiml = buildClosingTwiML("Thank you for your time. Please reach out to the individual directly. Goodbye.");
      res.type("text/xml");
      res.send(twiml);
      return;
    }

    if (!speechResult) {
      const twiml = buildResponseTwiML(
        "I'm sorry, I didn't catch that. Could you please repeat your question?",
        callSid,
        callSession.conversationHistory.length
      );
      res.type("text/xml");
      res.send(twiml);
      return;
    }

    const updatedHistory = [
      ...callSession.conversationHistory,
      { role: "contact" as const, content: speechResult },
    ];

    const prompt = buildCallResponsePrompt(
      callSession.crisisContext,
      speechResult,
      updatedHistory
    );

    const aiResponse = await generate(prompt, { maxTokens: 120, temperature: 0.6 });
    const cleanResponse = aiResponse.trim() || "I understand. Please reach out to them immediately.";

    await twilioSessionManager.update(callSid, {
      conversationHistory: [
        ...updatedHistory,
        { role: "ai" as const, content: cleanResponse },
      ],
    });

    const twiml = buildResponseTwiML(cleanResponse, callSid, updatedHistory.length);
    res.type("text/xml");
    res.send(twiml);
    
    logger.info("[TWILIO_TWIML_SENT]", { callSid, type: "response", twiml });

  } catch (err) {
    logger.error("[WEBHOOK_EXCEPTION]", { error: String(err), path: "/respond" });
    res.type("text/xml");
    res.send(buildErrorTwiML());
  }
};

// ── POST /api/twilio/voice/status — Call status webhook ───────────────────────
export const handleCallStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { CallSid, CallStatus, CallDuration, ErrorCode, ErrorMessage } = req.body;
    logger.info("[TWILIO_STATUS_CALLBACK]", { callSid: CallSid, status: CallStatus, duration: CallDuration, error: ErrorCode });

    const callSession = await twilioSessionManager.get(CallSid);
    const userId = callSession?.userId;

    const durationNum = CallDuration ? parseInt(CallDuration) : undefined;
    const errorText = ErrorMessage || CallStatus;

    if (CallStatus === "completed") {
      EscalationLogger.callCompleted({ userId: userId || "unknown", callSid: CallSid });
      await EscalationLog.findOneAndUpdate(
        { callSid: CallSid },
        { outcome: "completed", duration: durationNum, callStatus: CallStatus }
      );
      await twilioSessionManager.delete(CallSid);
    } else if (["failed", "busy", "no-answer", "canceled"].includes(CallStatus)) {
      EscalationLogger.callFailed({ userId: userId || "unknown", callSid: CallSid, error: errorText });
      await EscalationLog.findOneAndUpdate(
        { callSid: CallSid },
        { outcome: "failed", error: errorText, duration: durationNum, callStatus: CallStatus, twilioErrorCode: ErrorCode }
      );
      await twilioSessionManager.delete(CallSid);
    } else {
      // In-progress statuses like "ringing", "in-progress"
      await EscalationLog.findOneAndUpdate(
        { callSid: CallSid },
        { callStatus: CallStatus, twilioErrorCode: ErrorCode }
      );
    }

    res.sendStatus(204);
  } catch (err) {
    logger.error("[WEBHOOK_EXCEPTION]", { error: String(err), path: "/status" });
    res.sendStatus(204);
  }
};

