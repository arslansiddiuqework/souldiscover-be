/**
 * Admin Emergency Routes
 * ──────────────────────
 * Read-only access to escalation logs, emergency contacts, and Twilio status.
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

const router = Router();
router.use(adminAuth);

// ── GET /logs — All escalation logs ───────────────────────────────────────────
router.get("/logs", requirePermission("emergency.read"), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      EscalationLog.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      EscalationLog.countDocuments(),
    ]);

    // Enrich with user names
    const enrichedLogs = await Promise.all(
      logs.map(async (log) => {
        const user = await User.findById(log.userId).select("name email profileImage");
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
          contactPhone: log.contactPhone,
          contactWhatsApp: log.contactWhatsApp,
          callSid: log.callSid,
          outcome: log.outcome,
          error: log.error,
          duration: log.duration,
          callStatus: log.callStatus,
          twilioErrorCode: log.twilioErrorCode,
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
    logger.error("[ADMIN_EMERGENCY] List logs error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch escalation logs" });
  }
});

// ── GET /contacts — All users' emergency contacts ─────────────────────────────
router.get("/contacts", requirePermission("emergency.read"), async (req: Request, res: Response) => {
  try {
    const records = await EmergencyContact.find().populate("userId", "name email");

    const contacts = records.map((r) => ({
      userId: r.userId,
      consentAccepted: r.consentAccepted,
      consentAcceptedAt: r.consentAcceptedAt,
      contactCount: r.contacts.length,
      contacts: r.contacts,
      escalationSettings: r.escalationSettings,
    }));

    res.json({ contacts });
  } catch (error) {
    logger.error("[ADMIN_EMERGENCY] List contacts error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch emergency contacts" });
  }
});

// ── GET /status — System-wide emergency overview ──────────────────────────────
router.get("/status", requirePermission("emergency.read"), async (req: Request, res: Response) => {
  try {
    const [
      totalEscalations,
      initiatedCount,
      completedCount,
      failedCount,
      blockedCount,
      totalContactRecords,
      consentedCount,
      recentLogs,
    ] = await Promise.all([
      EscalationLog.countDocuments(),
      EscalationLog.countDocuments({ outcome: "initiated" }),
      EscalationLog.countDocuments({ outcome: "completed" }),
      EscalationLog.countDocuments({ outcome: "failed" }),
      EscalationLog.countDocuments({ outcome: "blocked" }),
      EmergencyContact.countDocuments(),
      EmergencyContact.countDocuments({ consentAccepted: true }),
      EscalationLog.find().sort({ createdAt: -1 }).limit(5),
    ]);

    // Check Twilio config
    const twilioConfigured = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    const twilioPhone = process.env.TWILIO_PHONE_NUMBER || "Not configured";
    const twilioWhatsApp = process.env.TWILIO_WHATSAPP_NUMBER || "Not configured";

    const settings = await SystemSettingsService.getSettings();
    const crisisEnabled = settings.crisisEnabled;
    const cooldownHours = settings.cooldownHours;
    const maxPerDay = settings.maxPerDay;

    res.json({
      system: {
        crisisEnabled,
        twilioConfigured,
        twilioPhone: process.env.TWILIO_PHONE_NUMBER || "Not configured",
        twilioWhatsApp: process.env.TWILIO_WHATSAPP_NUMBER || "Not configured",
        cooldownHours,
        maxPerDay,
      },
      stats: {
        totalEscalations,
        initiated: initiatedCount,
        completed: completedCount,
        failed: failedCount,
        blocked: blockedCount,
        totalContactRecords,
        usersWithConsent: consentedCount,
      },
      recentLogs: recentLogs.map((l) => ({
        riskLevel: l.riskLevel,
        outcome: l.outcome,
        contactCalled: l.contactCalled,
        createdAt: l.createdAt,
      })),
    });
  } catch (error) {
    logger.error("[ADMIN_EMERGENCY] Status error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch emergency status" });
  }
});

export default router;
