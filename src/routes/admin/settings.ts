/**
 * Admin Settings Routes
 * ─────────────────────
 * Get and update system settings.
 *
 * GET /api/admin/settings  — Retrieve current settings
 * PUT /api/admin/settings  — Update settings
 */

import { Router, Request, Response } from "express";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { requireAdminPassword } from "../../middleware/requireAdminPassword";
import { SystemSettingsService } from "../../services/crisis/settings.service";
import { recordSecurityEvent } from "../../services/securityAudit.service";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

// ── GET / — Retrieve current settings ─────────────────────────────────────────
router.get("/", requirePermission("settings.read"), async (req: Request, res: Response) => {
  try {
    const settings = await SystemSettingsService.getSettings();
    res.json({ settings });
  } catch (error) {
    logger.error("[ADMIN_SETTINGS] Get settings error", { error: String(error) });
    res.status(500).json({ message: "Failed to retrieve settings" });
  }
});

// ── PUT / — Update settings (requires step-up password) ───────────────────────
router.put(
  "/",
  requirePermission("settings.update"),
  requireAdminPassword,
  async (req: Request, res: Response) => {
  try {
    const { crisisEnabled, cooldownHours, maxPerDay } = req.body;
    
    // Simple validation — allowlist only
    const updatePayload: Record<string, any> = {};
    if (crisisEnabled !== undefined) updatePayload.crisisEnabled = !!crisisEnabled;
    if (cooldownHours !== undefined) {
      const parsed = parseFloat(cooldownHours);
      if (isNaN(parsed) || parsed < 0 || parsed > 168) {
        return res.status(400).json({ message: "Cooldown hours must be between 0 and 168." });
      }
      updatePayload.cooldownHours = parsed;
    }
    if (maxPerDay !== undefined) {
      const parsed = parseInt(maxPerDay);
      if (isNaN(parsed) || parsed < 0 || parsed > 100) {
        return res.status(400).json({ message: "Max escalations per day must be between 0 and 100." });
      }
      updatePayload.maxPerDay = parsed;
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ message: "No valid settings fields provided." });
    }

    const settings = await SystemSettingsService.updateSettings(updatePayload);
    
    logger.info("[ADMIN_SETTINGS_UPDATED] Settings updated by admin", { 
      adminId: String(req.admin?._id),
      update: updatePayload 
    });

    recordSecurityEvent({
      category: "ADMIN",
      severity: "WARNING",
      action: "settings_updated",
      description: "Crisis system settings updated.",
      actorType: "admin",
      actorId: req.admin!._id,
      email: req.admin!.email,
      req,
      meta: updatePayload,
    });

    res.json({ 
      message: "Settings updated successfully", 
      settings 
    });
  } catch (error) {
    logger.error("[ADMIN_SETTINGS] Update settings error", { error: String(error) });
    res.status(500).json({ message: "Failed to update settings" });
  }
});

export default router;
