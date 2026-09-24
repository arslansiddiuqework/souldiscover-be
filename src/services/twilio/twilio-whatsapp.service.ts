import { logger } from "../../utils/logger";
import { TwilioCallResult, EmergencyContactInfo } from "./twilio-types";
import { CrisisContext } from "../crisis/crisis-types";
import { twilioWhatsAppSessionManager, ActiveWhatsAppSession } from "./twilio-whatsapp-session-manager";

let _client: any = null;

function getTwilioClient(): any | null {
  if (_client) return _client;

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;

  if (!sid || !token || sid === "AC_your_account_sid_here") {
    return null;
  }

  try {
    const Twilio = require("twilio");
    _client = new Twilio(sid, token);
    return _client;
  } catch (err) {
    logger.error("[TWILIO] Failed to initialise client for WhatsApp", { error: String(err) });
    return null;
  }
}

export async function initiateEmergencyWhatsApp(
  crisisContext: CrisisContext,
  contact: EmergencyContactInfo & { whatsappNumber: string }
): Promise<TwilioCallResult> {
  const client = getTwilioClient();

  if (!client) {
    logger.info("[TWILIO_NOT_CONFIGURED] Skipping WhatsApp", {
      userId: crisisContext.userId,
      contact: contact.name,
    });
    return { success: false, error: "Twilio not configured" };
  }

  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || process.env.TWILIO_PHONE_NUMBER;

  if (!fromNumber) {
    logger.error("[TWILIO] TWILIO_WHATSAPP_NUMBER or TWILIO_PHONE_NUMBER missing");
    return { success: false, error: "Phone number not configured" };
  }

  const twilioWhatsAppFrom = `whatsapp:${fromNumber}`;
  const twilioWhatsAppTo = `whatsapp:${contact.whatsappNumber}`;

  logger.info("[TWILIO_WHATSAPP_ATTEMPT]", {
    to: twilioWhatsAppTo,
  });

  try {
    const message = await client.messages.create({
      body: `🚨 *URGENT ALERT from Soul Discovery*\n\nHello ${contact.name}, an emergency support event has been detected for ${crisisContext.userName}. Please check on them as soon as possible.\n\nReply to this message if you need more context or guidance.`,
      from: twilioWhatsAppFrom,
      to: twilioWhatsAppTo,
    });

    // Persist session so the webhook can retrieve context for replies
    const session: ActiveWhatsAppSession = {
      userId: crisisContext.userId,
      sessionId: crisisContext.sessionId,
      contactName: contact.name,
      contactWhatsApp: contact.whatsappNumber,
      crisisContext,
      conversationHistory: [],
      startedAt: new Date(),
    };
    await twilioWhatsAppSessionManager.set(contact.whatsappNumber, session);

    logger.info("[TWILIO_WHATSAPP_SENT]", { messageSid: message.sid, to: twilioWhatsAppTo });
    return { success: true, callSid: message.sid };

  } catch (err: any) {
    const msg = err?.message || String(err);
    logger.error("[WHATSAPP_FAILED]", { error: msg, contact: contact.name });
    return { success: false, error: msg };
  }
}
