/**
 * Admin Emergency Routes
 * ──────────────────────
 * Read-only access to escalation logs, emergency contacts, and SMS provider status.
 * Admin can VIEW but CANNOT trigger, override, or modify emergency events.
 *
 * GET /api/admin/emergency/logs      — All escalation logs (paginated)
 * GET /api/admin/emergency/contacts  — All users' emergency contacts
 * GET /api/admin/emergency/status    — System-wide emergency status overview
 */

import { Router, Request, Response } from "express";
import { EscalationLog } from "../../models/EscalationLog";
import { EmergencyContact } from "../../models/EmergencyContact";
import { User } from "../../models/User";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";
import { SystemSettingsService } from "../../services/crisis/settings.service";
import { maskPhone } from "../../utils/mask";
import {
  getSmsProvider,
  isSmsProviderConfigured,
  isVoiceEscalationAvailable,
} from "../../services/sms/sms.factory";

const router = Router();
router.use(adminAuth);

router.get(
  "/logs",
  requirePermission("emergency.read"),
  async (req: Request, res: Response) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const skip = (page - 1) * limit;

      const [logs, total] = await Promise.all([
        EscalationLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
        EscalationLog.countDocuments(),
      ]);

      const enrichedLogs = await Promise.all(
        logs.map(async (log) => {
          const user = await User.findById(log.userId).select(
            "name email profileImage"
          );
          return {
            _id: log._id,
            userId: log.userId,
            userName: user?.name || "Unknown",
            userEmail: user?.email || "",
            userProfileImage: user?.profileImage || "",
            sessionId: log.sessionId,
            riskLevel: log.riskLevel,
            crisisRiskScore: log.crisisRiskScore,
            escalationReason: log.escalationReason,
            contactCalled: log.contactCalled,
            contactPhone: maskPhone(log.contactPhone),
            contactWhatsApp: maskPhone(log.contactWhatsApp),
            contactPhoneMasked: true,
            callSid: log.callSid,
            smsBatchId: log.smsBatchId,
            channel: log.channel,
            provider: log.provider,
            deliveryStatus: log.deliveryStatus,
            voiceStatus: log.voiceStatus,
            outcome: log.outcome,
            error: log.error,
            duration: log.duration,
            callStatus: log.callStatus,
            twilioErrorCode: log.twilioErrorCode,
            providerErrorCode: log.providerErrorCode,
            createdAt: log.createdAt,
          };
        })
      );

      res.json({
        logs: enrichedLogs,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      logger.error("[ADMIN_EMERGENCY] List logs error", {
        error: String(error),
      });
      res.status(500).json({ message: "Failed to fetch escalation logs" });
    }
  }
);

router.get(
  "/contacts",
  requirePermission("emergency.read"),
  async (req: Request, res: Response) => {
    try {
      const records = await EmergencyContact.find().populate(
        "userId",
        "name email"
      );

      const reveal = String(req.query.reveal || "") === "1";

      const contacts = records.map((r) => ({
        userId: r.userId,
        consentAccepted: r.consentAccepted,
        consentAcceptedAt: r.consentAcceptedAt,
        contactCount: r.contacts.length,
        contacts: (r.contacts || []).map((c: any) => ({
          name: c.name,
          relationship: c.relationship,
          phone: reveal ? c.phone : maskPhone(c.phone),
          whatsapp: reveal ? c.whatsapp : maskPhone(c.whatsapp),
          isPrimary: c.isPrimary,
          phoneMasked: !reveal,
        })),
        escalationSettings: r.escalationSettings,
      }));

      res.json({ contacts, phonesRevealed: reveal });
    } catch (error) {
      logger.error("[ADMIN_EMERGENCY] List contacts error", {
        error: String(error),
      });
      res.status(500).json({ message: "Failed to fetch emergency contacts" });
    }
  }
);

router.get(
  "/status",
  requirePermission("emergency.read"),
  async (req: Request, res: Response) => {
    try {
      const [
        totalEscalations,
        initiatedCount,
        completedCount,
        failedCount,
        blockedCount,
        queuedCount,
        deliveredCount,
        totalContactRecords,
        consentedCount,
        recentLogs,
      ] = await Promise.all([
        EscalationLog.countDocuments(),
        EscalationLog.countDocuments({ outcome: "initiated" }),
        EscalationLog.countDocuments({ outcome: "completed" }),
        EscalationLog.countDocuments({ outcome: "failed" }),
        EscalationLog.countDocuments({ outcome: "blocked" }),
        EscalationLog.countDocuments({
          deliveryStatus: { $in: ["queued", "accepted", "pending"] },
        }),
        EscalationLog.countDocuments({ deliveryStatus: "delivered" }),
        EmergencyContact.countDocuments(),
        EmergencyContact.countDocuments({ consentAccepted: true }),
        EscalationLog.find().sort({ createdAt: -1 }).limit(5),
      ]);

      const smsConfigured = isSmsProviderConfigured();
      const provider = getSmsProvider();
      const voiceAvailable = isVoiceEscalationAvailable();

      const settings = await SystemSettingsService.getSettings();
      const crisisEnabled = settings.crisisEnabled;
      const cooldownHours = settings.cooldownHours;
      const maxPerDay = settings.maxPerDay;

      // Overall "operational" only when crisis + SMS work; voice never implied.
      const emergencySmsOperational = crisisEnabled && smsConfigured;
      const emergencyFullyOperational =
        emergencySmsOperational && voiceAvailable;

      res.json({
        system: {
          crisisEnabled,
          smsProvider: provider.name,
          smsConfigured,
          // Never return API keys. Presence only.
          textbeeConfigured: smsConfigured,
          voiceAvailable,
          voiceStatus: voiceAvailable ? "available" : "VOICE_UNAVAILABLE",
          emergencySmsOperational,
          emergencyFullyOperational,
          // Backward-compatible aliases (admin FE may still read these keys)
          twilioConfigured: false,
          twilioPhoneConfigured: false,
          twilioWhatsAppConfigured: false,
          twilioPhone: "Not configured (Twilio removed)",
          twilioWhatsApp: "Not configured (Twilio removed)",
          cooldownHours,
          maxPerDay,
        },
        stats: {
          totalEscalations,
          initiated: initiatedCount,
          completed: completedCount,
          failed: failedCount,
          blocked: blockedCount,
          queued: queuedCount,
          delivered: deliveredCount,
          totalContactRecords,
          usersWithConsent: consentedCount,
        },
        recentLogs: recentLogs.map((l) => ({
          riskLevel: l.riskLevel,
          outcome: l.outcome,
          deliveryStatus: l.deliveryStatus,
          channel: l.channel,
          contactCalled: l.contactCalled,
          createdAt: l.createdAt,
        })),
      });
    } catch (error) {
      logger.error("[ADMIN_EMERGENCY] Status error", { error: String(error) });
      res.status(500).json({ message: "Failed to fetch emergency status" });
    }
  }
);

export default router;
