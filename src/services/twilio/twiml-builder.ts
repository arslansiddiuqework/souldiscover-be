/**
 * TwiML Builder
 * ─────────────
 * Generates Twilio Markup Language (TwiML) XML strings.
 * Uses Twilio's built-in <Say voice="alice"> — no external TTS needed.
 * All speech input collected via <Gather input="speech">.
 */

import { logger } from "../../utils/logger";

const BASE_URL = process.env.BASE_URL || process.env.BACKEND_URL || "";

// ── Escape XML special characters ─────────────────────────────────────────────
function xmlEscape(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Opening greeting TwiML ─────────────────────────────────────────────────────
// Called on first Twilio webhook hit (call just connected)
export function buildGreetingTwiML(
  contactName: string,
  userName: string,
  openingMessage: string,
  callSid: string
): string {
  const safeMessage = xmlEscape(openingMessage);
  const safeContact = xmlEscape(contactName);

  logger.info("[TWIML] Building greeting", { callSid, contactName });

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-US">${safeMessage}</Say><Gather input="speech" action="${BASE_URL}/api/twilio/voice/respond?callSid=${encodeURIComponent(callSid)}" method="POST" timeout="8" speechTimeout="3" language="en-US"><Say voice="alice" language="en-US">Please feel free to ask me anything, ${safeContact}.</Say></Gather><Say voice="alice" language="en-US">I didn't catch that. I'll try again shortly. Please call us back if you need more information.</Say><Hangup/></Response>`;
}

// ── AI response TwiML ──────────────────────────────────────────────────────────
// Called after contact speaks — AI reply + gather next input
export function buildResponseTwiML(
  aiResponse: string,
  callSid: string,
  turnCount: number
): string {
  const safeResponse = xmlEscape(aiResponse);
  const MAX_TURNS = 6; // Limit conversation length

  if (turnCount >= MAX_TURNS) {
    return buildClosingTwiML(
      "Thank you for your time and concern. Please reach out to the individual directly. Take care, and goodbye."
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-US">${safeResponse}</Say><Gather input="speech" action="${BASE_URL}/api/twilio/voice/respond?callSid=${encodeURIComponent(callSid)}" method="POST" timeout="8" speechTimeout="3" language="en-US"><Say voice="alice" language="en-US">Is there anything else I can help you with?</Say></Gather><Say voice="alice" language="en-US">Thank you for your concern. Please reach out to the individual directly. Goodbye.</Say><Hangup/></Response>`;
}

// ── Closing TwiML ──────────────────────────────────────────────────────────────
export function buildClosingTwiML(message: string): string {
  const safeMessage = xmlEscape(message);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-US">${safeMessage}</Say><Hangup/></Response>`;
}

// ── Error fallback TwiML ───────────────────────────────────────────────────────
export function buildErrorTwiML(): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-US">We apologize, there was a technical issue processing your response. Please contact the individual directly. Thank you and goodbye.</Say><Hangup/></Response>`;
}
