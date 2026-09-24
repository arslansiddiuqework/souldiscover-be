import { Request, Response } from "express";
import { logger } from "../../utils/logger";
import { twilioWhatsAppSessionManager } from "./twilio-whatsapp-session-manager";
import { generate } from "../llm.service";
import twilio from "twilio";

export const handleWhatsAppWebhook = async (req: Request, res: Response) => {
  try {
    const { From, Body } = req.body;
    logger.info(`[TWILIO_WHATSAPP] Received message from ${From}: ${Body}`);

    // From is typically "whatsapp:+923001234567"
    const contactWhatsApp = From.replace("whatsapp:", "");
    
    const session = await twilioWhatsAppSessionManager.get(contactWhatsApp);

    const twiml = new twilio.twiml.MessagingResponse();

    if (!session) {
      logger.warn(`[TWILIO_WHATSAPP] No active session found for ${contactWhatsApp}`);
      twiml.message("There is no active emergency session at this time. If this is an emergency, please contact local authorities.");
      res.type("text/xml");
      return res.send(twiml.toString());
    }

    // Save user's reply
    await twilioWhatsAppSessionManager.updateHistory(contactWhatsApp, { role: "user", content: Body });

    // Format context for the LLM
    const systemPrompt = `You are an AI Emergency Coordinator for an AI therapy application called Soul Discovery.
You have just escalated a mental health crisis event for a user.
You are currently texting with their emergency contact via WhatsApp.

CRITICAL RULES:
1. EXPLAIN the situation safely but clearly. State that the user triggered an emergency threshold.
2. ENCOURAGE the contact to reach out to the user immediately.
3. BE HELPFUL and answer follow-up questions about the severity if asked.
4. DO NOT reveal specific, private therapy conversation details (e.g. do not say exactly what the user said). Use generalizations like "expressed severe distress" or "exhibited signs of panic".
5. Keep your messages concise, as this is SMS/WhatsApp.
6. Speak directly to the emergency contact.

CONTEXT:
User Name: ${session.crisisContext.userName}
Risk Level: ${session.crisisContext.assessment.riskLevel}
Reason for Escalation: ${session.crisisContext.assessment.escalationReason}

Conversation so far:
${session.conversationHistory.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join("\n")}
`;

    // Generate AI response
    logger.info(`[TWILIO_WHATSAPP] Generating AI response for ${contactWhatsApp}...`);
    const aiResponse = await generate(systemPrompt, { maxTokens: 200, temperature: 0.5 });
    
    await twilioWhatsAppSessionManager.updateHistory(contactWhatsApp, { role: "assistant", content: aiResponse });

    twiml.message(aiResponse);

    res.type("text/xml");
    res.send(twiml.toString());

  } catch (err) {
    logger.error("[TWILIO_WHATSAPP_ERROR]", { error: String(err) });
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("We encountered an error processing your message. Please reach out to the user directly.");
    res.type("text/xml");
    res.send(twiml.toString());
  }
};
