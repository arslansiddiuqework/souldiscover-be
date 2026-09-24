/**
 * Twilio Webhook Routes
 * ─────────────────────
 * These routes are called directly by Twilio — NO auth middleware.
 * Twilio signs its requests (X-Twilio-Signature header) — validation
 * can be added in production but is omitted here for FYP simplicity.
 */

import express from "express";
import {
  handleVoiceWebhook,
  handleVoiceIntro,
  handleVoiceRespond,
  handleCallStatus,
  handleDebug,
} from "../services/twilio/twilio-voice.controller";
import { handleWhatsAppWebhook } from "../services/twilio/twilio-whatsapp.controller";

const router = express.Router();

// Public debug route
router.get("/debug",          handleDebug);

// Called by Twilio when the outbound call connects (Bridge handshake)
router.post("/voice",         handleVoiceWebhook);

// Called by the bridge to play the real intro greeting
router.post("/voice/intro",   handleVoiceIntro);

// Called by Twilio when the contact finishes speaking (Gather result)
router.post("/voice/respond", handleVoiceRespond);

// Called by Twilio on call status changes (ringing, completed, failed, etc.)
router.post("/voice/status",  handleCallStatus);

// Called by Twilio for incoming WhatsApp messages
router.post("/whatsapp", handleWhatsAppWebhook);

export default router;
