/**
 * Escalation Cooldown Service
 * ────────────────────────────
 * Prevents escalation spam via:
 *  1. Per-user cooldown window (DB-backed)
 *  2. Max escalations per day (DB-backed)
 *  3. Per-session deduplication (in-memory)
 */

import { EscalationLog } from "../../models/EscalationLog";
import { SystemSettingsService } from "./settings.service";
import { logger } from "../../utils/logger";

// ── In-memory session dedup ────────────────────────────────────────────────────
// Cleared on server restart — fine for FYP; prevents repeated triggers within a session
const escalatedSessions = new Set<string>();

export const EscalationCooldown = {
  // ── 1. Is user within cooldown window? ──────────────────────────────────────
  async isOnCooldown(userId: string): Promise<boolean> {
    try {
      const settings = await SystemSettingsService.getSettings();
      const cooldownHours = settings.cooldownHours;
      const cutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);
      const count = await EscalationLog.countDocuments({
        userId,
        createdAt: { $gte: cutoff },
        outcome: { $in: ["initiated", "completed"] },
      });
      return count > 0;
    } catch (err) {
      logger.warn("[COOLDOWN] Check failed, allowing escalation", { error: String(err) });
      return false; // fail-open: if DB is down, still allow
    }
  },

  // ── 2. Has user hit the daily limit? ────────────────────────────────────────
  async isMaxPerDayReached(userId: string): Promise<boolean> {
    try {
      const settings = await SystemSettingsService.getSettings();
      const maxPerDay = settings.maxPerDay;
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const count = await EscalationLog.countDocuments({
        userId,
        createdAt: { $gte: startOfDay },
      });
      return count >= maxPerDay;
    } catch (err) {
      logger.warn("[COOLDOWN] Max-per-day check failed, allowing escalation", { error: String(err) });
      return false;
    }
  },

  // ── 3. Was this session already escalated? ───────────────────────────────────
  isSessionAlreadyEscalated(sessionId: string): boolean {
    return escalatedSessions.has(sessionId);
  },

  markSessionEscalated(sessionId: string): void {
    escalatedSessions.add(sessionId);
    // Auto-cleanup after 24h to prevent unbounded memory growth
    setTimeout(() => escalatedSessions.delete(sessionId), 24 * 60 * 60 * 1000);
  },
};
