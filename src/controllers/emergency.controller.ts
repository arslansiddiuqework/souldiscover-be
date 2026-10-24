/**
 * Emergency Contacts Controller
 * CRUD operations for emergency contacts and consent management.
 * All routes require authentication (via existing auth middleware).
 */

import { Request, Response } from "express";
import { Types }             from "mongoose";
import { EmergencyContact }  from "../models/EmergencyContact";
import { EscalationLog }     from "../models/EscalationLog";
import { logger }            from "../utils/logger";
import { sendTestEmergencySms } from "../services/sms/emergency-sms.service";
import { isSmsProviderConfigured, isVoiceEscalationAvailable } from "../services/sms/sms.factory";
import { normalizeE164, redactPhone } from "../utils/phone";

// Get emergency contacts for user
export const getEmergencyContacts = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const record = await EmergencyContact.findOne({ userId });
    res.json(record || { userId, consentAccepted: false, contacts: [], escalationSettings: {} });
  } catch (err) {
    logger.error("getEmergencyContacts error", { error: String(err) });
    res.status(500).json({ message: "Failed to fetch emergency contacts" });
  }
};

// Add a single emergency contact
export const addEmergencyContact = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const { name, relationship, phone, whatsappNumber, preferredContactMethod, priority, enabled } = req.body;

    if (!name || !relationship) {
      return res.status(400).json({ message: "Name and relationship are required" });
    }

    const method = preferredContactMethod || "phone";
    if ((method === "phone" || method === "both") && !phone) {
      return res.status(400).json({ message: "Phone number is required for phone method" });
    }
    if ((method === "whatsapp" || method === "both") && !whatsappNumber) {
      return res.status(400).json({ message: "WhatsApp number is required for whatsapp method" });
    }

    let record = await EmergencyContact.findOne({ userId });
    if (!record) {
      record = new EmergencyContact({ userId, consentAccepted: false, contacts: [] });
    }

    // Check duplicate phone
    const duplicate = record.contacts.find((c) => c.phone === phone);
    if (duplicate) {
      return res.status(409).json({ message: "A contact with this phone number already exists" });
    }

    // Max 5 contacts
    if (record.contacts.length >= 5) {
      return res.status(400).json({ message: "Maximum 5 emergency contacts allowed" });
    }

    record.contacts.push({
      name: name.trim(),
      relationship: relationship.trim(),
      preferredContactMethod: method,
      phone: phone || undefined,
      whatsappNumber: whatsappNumber || undefined,
      priority: priority || record.contacts.length + 1,
      enabled: enabled !== false,
    });

    await record.save();
    logger.info("Emergency contact added", { userId: userId.toString() });
    res.status(201).json({ message: "Contact added", contacts: record.contacts });
  } catch (err: any) {
    if (err?.name === "ValidationError") {
      return res.status(400).json({ message: err.message });
    }
    logger.error("addEmergencyContact error", { error: String(err) });
    res.status(500).json({ message: "Failed to add contact" });
  }
};

// Update an existing emergency contact
export const updateEmergencyContact = async (req: Request, res: Response) => {
  try {
    const userId    = req.user._id;
    const { contactId } = req.params;
    const updates   = req.body;

    const record = await EmergencyContact.findOne({ userId });
    if (!record) return res.status(404).json({ message: "No emergency contacts found" });

    const contact = (record.contacts as Types.DocumentArray<any>).id(contactId);
    if (!contact) return res.status(404).json({ message: "Contact not found" });

    if (updates.name)         contact.name         = updates.name.trim();
    if (updates.relationship) contact.relationship = updates.relationship.trim();
    if (updates.preferredContactMethod) contact.preferredContactMethod = updates.preferredContactMethod;
    if (updates.phone !== undefined) contact.phone = updates.phone;
    if (updates.whatsappNumber !== undefined) contact.whatsappNumber = updates.whatsappNumber;
    if (updates.priority !== undefined) contact.priority = updates.priority;
    if (updates.enabled  !== undefined) contact.enabled  = updates.enabled;

    await record.save();
    res.json({ message: "Contact updated", contacts: record.contacts });
  } catch (err) {
    logger.error("updateEmergencyContact error", { error: String(err) });
    res.status(500).json({ message: "Failed to update contact" });
  }
};

// Delete an emergency contact
export const deleteEmergencyContact = async (req: Request, res: Response) => {
  try {
    const userId      = req.user._id;
    const { contactId } = req.params;

    const record = await EmergencyContact.findOne({ userId });
    if (!record) return res.status(404).json({ message: "No emergency contacts found" });

    const contact = (record.contacts as Types.DocumentArray<any>).id(contactId);
    if (!contact) return res.status(404).json({ message: "Contact not found" });

    contact.deleteOne();
    await record.save();
    res.json({ message: "Contact removed", contacts: record.contacts });
  } catch (err) {
    logger.error("deleteEmergencyContact error", { error: String(err) });
    res.status(500).json({ message: "Failed to delete contact" });
  }
};

// Accept emergency consent
export const acceptConsent = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const acceptedAt = new Date();

    let record =
      (await EmergencyContact.findOneAndUpdate(
        { userId },
        {
          $set: {
            consentAccepted: true,
            consentAcceptedAt: acceptedAt,
          },
          $setOnInsert: {
            contacts: [],
          },
        },
        { upsert: true, new: true, runValidators: true }
      )) ||
      (await EmergencyContact.findOneAndUpdate(
        { userId },
        {
          $set: {
            consentAccepted: true,
            consentAcceptedAt: acceptedAt,
          },
        },
        { new: true }
      ));

    if (!record) {
      return res.status(500).json({ message: "Failed to save consent" });
    }

    logger.info("Emergency consent accepted", { userId: userId.toString() });
    res.json({
      message: "Consent accepted",
      consentAccepted: true,
      consentAcceptedAt: record.consentAcceptedAt,
    });
  } catch (err: any) {
    // Duplicate key on concurrent upsert — retry as update.
    if (err?.code === 11000) {
      try {
        const userId = req.user._id;
        const record = await EmergencyContact.findOneAndUpdate(
          { userId },
          {
            $set: {
              consentAccepted: true,
              consentAcceptedAt: new Date(),
            },
          },
          { new: true }
        );
        if (record) {
          return res.json({
            message: "Consent accepted",
            consentAccepted: true,
            consentAcceptedAt: record.consentAcceptedAt,
          });
        }
      } catch (retryErr) {
        logger.error("acceptConsent retry error", { error: String(retryErr) });
      }
    }
    logger.error("acceptConsent error", { error: String(err) });
    res.status(500).json({ message: "Failed to save consent" });
  }
};

// Update escalation settings (User can only toggle auto-call opt-in)
export const updateEscalationSettings = async (req: Request, res: Response) => {
  try {
    const userId   = req.user._id;
    const { autoCallEnabled } = req.body;

    const update: Record<string, any> = {};
    if (autoCallEnabled !== undefined) update["escalationSettings.autoCallEnabled"] = autoCallEnabled;

    const record = await EmergencyContact.findOneAndUpdate(
      { userId },
      { $set: update },
      { upsert: true, new: true }
    );

    res.json({ message: "Settings updated", escalationSettings: record.escalationSettings });
  } catch (err) {
    logger.error("updateEscalationSettings error", { error: String(err) });
    res.status(500).json({ message: "Failed to update settings" });
  }
};

// Get escalation status
export const getEscalationStatus = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const record = await EmergencyContact.findOne({ userId });
    const cooldownHours = record?.escalationSettings?.cooldownHours
      ?? parseInt(process.env.CRISIS_COOLDOWN_HOURS || "6");

    // Find most recent escalation
    const lastEscalation = await EscalationLog.findOne({ userId }).sort({ createdAt: -1 });

    let onCooldown = false;
    let cooldownExpiresAt: Date | null = null;

    if (lastEscalation && ["initiated", "completed"].includes(lastEscalation.outcome)) {
      const expiresAt = new Date(
        lastEscalation.createdAt.getTime() + cooldownHours * 60 * 60 * 1000
      );
      if (expiresAt > new Date()) {
        onCooldown = true;
        cooldownExpiresAt = expiresAt;
      }
    }

    res.json({
      consentAccepted:    record?.consentAccepted || false,
      autoCallEnabled:    record?.escalationSettings?.autoCallEnabled || false,
      contactCount:       record?.contacts?.length || 0,
      onCooldown,
      cooldownExpiresAt,
      lastEscalation:     lastEscalation
        ? { outcome: lastEscalation.outcome, createdAt: lastEscalation.createdAt }
        : null,
    });
  } catch (err) {
    logger.error("getEscalationStatus error", { error: String(err) });
    res.status(500).json({ message: "Failed to get escalation status" });
  }
};
/**
 * Manual connectivity test — sends a TextBee SMS (not a voice call).
 * Route path `/test-call` kept for API compatibility; response is SMS-oriented.
 */
export const triggerTestCall = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const { contactId } = req.body;

    if (!isSmsProviderConfigured()) {
      return res.status(503).json({
        message:
          "SMS provider is not configured. Set TEXTBEE_API_KEY on the backend.",
        voiceStatus: "VOICE_UNAVAILABLE",
        smsConfigured: false,
      });
    }

    const record = await EmergencyContact.findOne({ userId });
    if (!record) {
      return res.status(404).json({ message: "No emergency contacts configured." });
    }

    let contact;
    if (contactId) {
      contact = (record.contacts as Types.DocumentArray<any>).id(contactId);
      if (!contact) {
        return res.status(404).json({ message: "Requested contact not found." });
      }
    } else {
      contact = record.contacts.find((c) => c.enabled);
      if (!contact) {
        return res
          .status(404)
          .json({ message: "No enabled contact available for testing." });
      }
    }

    const phone =
      normalizeE164(contact.phone) ||
      normalizeE164((contact as any).whatsappNumber);
    if (!phone) {
      return res.status(400).json({
        message: `Contact '${contact.name}' needs a valid E.164 phone number.`,
      });
    }

    logger.info("[DEBUG] Triggering manual test SMS", {
      userId,
      contact: contact.name,
      to: redactPhone(phone),
      voiceAvailable: isVoiceEscalationAvailable(),
    });

    const result = await sendTestEmergencySms(
      {
        name: contact.name,
        phone,
        relationship: contact.relationship,
      },
      req.user.name || "Test User"
    );

    if (result.ok) {
      // Acceptance = queued, not carrier delivery
      return res.json({
        message: `Test SMS accepted by TextBee and queued for ${contact.name} (${redactPhone(phone)}). Delivery depends on the registered Android device being online.`,
        smsBatchId: result.smsBatchId,
        deliveryStatus: result.status,
        voiceStatus: "VOICE_UNAVAILABLE",
        provider: result.provider,
      });
    }

    const status =
      result.code === "http_401"
        ? 401
        : result.code === "http_429"
          ? 429
          : result.code === "invalid_number" || result.code === "invalid_message"
            ? 400
            : 502;

    return res.status(status).json({
      message: `Test SMS failed: ${result.error}`,
      code: result.code,
      voiceStatus: "VOICE_UNAVAILABLE",
    });
  } catch (err: any) {
    logger.error("triggerTestCall error", { error: String(err) });
    res.status(500).json({
      message: `Internal server error during test SMS: ${err.message}`,
    });
  }
};
