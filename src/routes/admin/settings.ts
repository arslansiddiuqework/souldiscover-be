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
import { SystemSettingsService } from "../../services/crisis/settings.service";
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

// ── PUT / — Update settings ───────────────────────────────────────────────────
router.put("/", requirePermission("settings.update"), async (req: Request, res: Response) => {
  try {
    const { crisisEnabled, cooldownHours, maxPerDay } = req.body;
    
    // Simple validation
    const updatePayload: Record<string, any> = {};
    if (crisisEnabled !== undefined) updatePayload.crisisEnabled = !!crisisEnabled;
    if (cooldownHours !== undefined) {
      const parsed = parseFloat(cooldownHours);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ message: "Cooldown hours must be a non-negative number." });
      }
      updatePayload.cooldownHours = parsed;
    }
    if (maxPerDay !== undefined) {
      const parsed = parseInt(maxPerDay);
      if (isNaN(parsed) || parsed < 0) {
        return res.status(400).json({ message: "Max escalations per day must be a non-negative integer." });
      }
      updatePayload.maxPerDay = parsed;
    }

    const settings = await SystemSettingsService.updateSettings(updatePayload);
    
    logger.info("[ADMIN_SETTINGS_UPDATED] Settings updated by admin", { 
      adminId: (req as any).admin?._id,
      update: updatePayload 
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
