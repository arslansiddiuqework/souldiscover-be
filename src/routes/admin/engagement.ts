/**
 * Admin Engagement Routes
 * ───────────────────────
 * Mirrors user /progress + check-ins for ops: mood, activities, chat depth.
 *
 * GET /api/admin/engagement
 */

import { Router, Request, Response } from "express";
import { Mood } from "../../models/Mood";
import { Activity } from "../../models/Activity";
import { ChatSession } from "../../models/ChatSession";
import { User } from "../../models/User";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

router.get("/", requirePermission("analytics.read"), async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      moodPerDay,
      moodByLabel,
      activityBreakdown,
      recentMoods,
      recentActivities,
      messageSourceAgg,
      lowMoodUsers,
    ] = await Promise.all([
      Mood.aggregate([
        { $match: { timestamp: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
            count: { $sum: 1 },
            avgScore: { $avg: "$score" },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Mood.aggregate([
        { $match: { timestamp: { $gte: sevenDaysAgo } } },
        { $group: { _id: "$mood", count: { $sum: 1 }, avgScore: { $avg: "$score" } } },
        { $sort: { count: -1 } },
        { $limit: 12 },
      ]),
      Activity.aggregate([
        { $match: { timestamp: { $gte: sevenDaysAgo } } },
        {
          $group: {
            _id: "$type",
            count: { $sum: 1 },
            completedCount: { $sum: { $cond: ["$completed", 1, 0] } },
            totalMinutes: { $sum: { $ifNull: ["$duration", 0] } },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Mood.find({ timestamp: { $gte: sevenDaysAgo } })
        .sort({ timestamp: -1 })
        .limit(25)
        .select("userId score mood source note timestamp")
        .lean(),
      Activity.find({ timestamp: { $gte: sevenDaysAgo } })
        .sort({ timestamp: -1 })
        .limit(25)
        .select("userId type name duration completed timestamp")
        .lean(),
      ChatSession.aggregate([
        { $match: { startTime: { $gte: sevenDaysAgo }, "messages.0": { $exists: true } } },
        { $unwind: "$messages" },
        {
          $group: {
            _id: { $ifNull: ["$messages.metadata.source", "text"] },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Mood.aggregate([
        { $match: { timestamp: { $gte: sevenDaysAgo }, score: { $lt: 40 } } },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: "$userId",
            latestScore: { $first: "$score" },
            latestMood: { $first: "$mood" },
            lowCount: { $sum: 1 },
            lastAt: { $first: "$timestamp" },
          },
        },
        { $sort: { lowCount: -1 } },
        { $limit: 15 },
      ]),
    ]);

    const moodUserIds = [
      ...recentMoods.map((m) => String(m.userId)),
      ...recentActivities.map((a) => String(a.userId)),
      ...lowMoodUsers.map((u) => String(u._id)),
    ];
    const uniqueIds = [...new Set(moodUserIds.filter(Boolean))];
    const users = uniqueIds.length
      ? await User.find({ _id: { $in: uniqueIds } })
          .select("name email profileImage status")
          .lean()
      : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const enrichUser = (id: unknown) => {
      const u = userMap.get(String(id));
      return {
        userId: String(id),
        name: u?.name || "Unknown",
        email: u?.email || "",
        profileImage: u?.profileImage || "",
        status: u?.status || "active",
      };
    };

    res.json({
      window: { from: sevenDaysAgo.toISOString(), to: now.toISOString() },
      mood: {
        perDay: moodPerDay.map((d) => ({
          date: d._id,
          count: d.count,
          avgScore: Math.round(d.avgScore || 0),
        })),
        byLabel: moodByLabel.map((d) => ({
          mood: d._id || "unknown",
          count: d.count,
          avgScore: Math.round(d.avgScore || 0),
        })),
        recent: recentMoods.map((m) => ({
          ...enrichUser(m.userId),
          score: m.score,
          mood: m.mood,
          source: m.source,
          note: m.note ? String(m.note).slice(0, 120) : "",
          timestamp: m.timestamp,
        })),
        needsAttention: lowMoodUsers.map((u) => ({
          ...enrichUser(u._id),
          latestScore: u.latestScore,
          latestMood: u.latestMood,
          lowCount: u.lowCount,
          lastAt: u.lastAt,
        })),
      },
      activities: {
        breakdown: activityBreakdown,
        recent: recentActivities.map((a) => ({
          ...enrichUser(a.userId),
          type: a.type,
          activityName: a.name,
          duration: a.duration,
          completed: a.completed,
          timestamp: a.timestamp,
        })),
      },
      chat: {
        messageSources: messageSourceAgg.map((s) => ({
          source: s._id || "text",
          count: s.count,
        })),
      },
    });
  } catch (error) {
    logger.error("[ADMIN_ENGAGEMENT] Error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch engagement data" });
  }
});

export default router;
