/**
 * Admin AI Usage Routes
 * ─────────────────────
 * Surfaces AiUsageCounter data for ops (quotas / spend proxies).
 *
 * GET /api/admin/ai-usage
 */

import { Router, Request, Response } from "express";
import { AiUsageCounter } from "../../models/AiUsageCounter";
import { User } from "../../models/User";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import {
  GLOBAL_MONTHLY_LIMIT,
  USER_MONTHLY_LIMIT,
  getGlobalDailyLimit,
  utcDayKey,
  utcMonthKey,
} from "../../services/aiQuota.service";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

router.get("/", requirePermission("analytics.read"), async (_req: Request, res: Response) => {
  try {
    const dayKey = utcDayKey();
    const monthKey = utcMonthKey();
    const dailyLimit = getGlobalDailyLimit();

    const [dayDoc, monthDoc, topUsers] = await Promise.all([
      AiUsageCounter.findOne({ scope: "global_day", periodKey: dayKey }).lean(),
      AiUsageCounter.findOne({ scope: "global_month", periodKey: monthKey }).lean(),
      AiUsageCounter.find({ scope: "user_month", periodKey: { $regex: `:${monthKey}$` } })
        .sort({ count: -1 })
        .limit(20)
        .lean(),
    ]);

    const userIds = topUsers
      .map((row) => row.userId)
      .filter(Boolean)
      .map(String);

    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select("name email profileImage status")
          .lean()
      : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    res.json({
      period: { dayKey, monthKey },
      limits: {
        globalDaily: dailyLimit,
        globalMonthly: GLOBAL_MONTHLY_LIMIT,
        userMonthly: USER_MONTHLY_LIMIT,
      },
      usage: {
        globalDay: dayDoc?.count || 0,
        globalMonth: monthDoc?.count || 0,
        globalDayRemaining: Math.max(0, dailyLimit - (dayDoc?.count || 0)),
        globalMonthRemaining: Math.max(
          0,
          GLOBAL_MONTHLY_LIMIT - (monthDoc?.count || 0)
        ),
      },
      topUsers: topUsers.map((row) => {
        const u = row.userId ? userMap.get(String(row.userId)) : undefined;
        return {
          userId: row.userId ? String(row.userId) : null,
          periodKey: row.periodKey,
          count: row.count,
          limit: USER_MONTHLY_LIMIT,
          remaining: Math.max(0, USER_MONTHLY_LIMIT - row.count),
          name: u?.name || "Unknown",
          email: u?.email || "",
          profileImage: u?.profileImage || "",
          status: u?.status || "active",
        };
      }),
    });
  } catch (error) {
    logger.error("[ADMIN_AI_USAGE] Error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch AI usage" });
  }
});

export default router;
