/**
 * Admin Analytics Routes
 * ──────────────────────
 * Aggregates real data from existing MongoDB collections.
 * NO fake metrics — only data derivable from the database.
 *
 * GET /api/admin/analytics — Dashboard analytics
 */

import { Router, Request, Response } from "express";
import { User } from "../../models/User";
import { ChatSession } from "../../models/ChatSession";
import { EscalationLog } from "../../models/EscalationLog";
import { Activity } from "../../models/Activity";
import { Mood } from "../../models/Mood";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

// ── GET / — Dashboard analytics ───────────────────────────────────────────────
router.get("/", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ── Core counts ──
    const [
      totalUsers,
      newUsersThisWeek,
      newUsersThisMonth,
      totalSessions,
      activeSessions,
      totalEscalations,
      escalationsThisWeek,
      totalActivities,
      totalMoodEntries,
      weeklySessions,
      weeklyCompletedSessions,
      weeklyActivities,
      weeklyCompletedActivities,
      weeklyHighRiskSessions,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
      ChatSession.countDocuments({ "messages.0": { $exists: true } }),
      ChatSession.countDocuments({ status: "active", "messages.0": { $exists: true } }),
      EscalationLog.countDocuments(),
      EscalationLog.countDocuments({ createdAt: { $gte: sevenDaysAgo } }),
      Activity.countDocuments(),
      Mood.countDocuments(),
      ChatSession.countDocuments({ startTime: { $gte: sevenDaysAgo }, "messages.0": { $exists: true } }),
      ChatSession.countDocuments({ startTime: { $gte: sevenDaysAgo }, status: "completed", "messages.0": { $exists: true } }),
      Activity.countDocuments({ timestamp: { $gte: sevenDaysAgo } }),
      Activity.countDocuments({ timestamp: { $gte: sevenDaysAgo }, completed: true }),
      ChatSession.countDocuments({
        startTime: { $gte: sevenDaysAgo },
        "messages.0": { $exists: true },
        $or: [
          { "messages.metadata.progress.riskLevel": { $gt: 0.5 } },
          { "messages.metadata.emotionMeta.crisisRiskScore": { $gt: 0.5 } },
        ],
      }),
    ]);

    const [weeklySessionUsers, weeklyActivityUsers, weeklyMoodUsers] = await Promise.all([
      ChatSession.distinct("userId", { startTime: { $gte: sevenDaysAgo }, "messages.0": { $exists: true } }),
      Activity.distinct("userId", { timestamp: { $gte: sevenDaysAgo } }),
      Mood.distinct("userId", { timestamp: { $gte: sevenDaysAgo } }),
    ]);

    const weeklyActiveUsers = new Set([
      ...weeklySessionUsers.map(String),
      ...weeklyActivityUsers.map(String),
      ...weeklyMoodUsers.map(String),
    ]).size;

    // ── Average session duration (across all sessions) ──
    const durationAgg = await ChatSession.aggregate([
      { $match: { "messages.1": { $exists: true } } },
      {
        $project: {
          duration: {
            $subtract: [
              { $arrayElemAt: ["$messages.timestamp", -1] },
              { $arrayElemAt: ["$messages.timestamp", 0] },
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgDuration: { $avg: "$duration" },
        },
      },
    ]);
    const avgSessionDurationMs = durationAgg[0]?.avgDuration || 0;
    const avgSessionMinutes = Math.round(avgSessionDurationMs / 60000);

    // â”€â”€ Weekly session depth â”€â”€
    const weeklySessionAgg = await ChatSession.aggregate([
      { $match: { startTime: { $gte: sevenDaysAgo }, "messages.0": { $exists: true } } },
      { $project: { messageCount: { $size: "$messages" } } },
      {
        $group: {
          _id: null,
          weeklyMessageCount: { $sum: "$messageCount" },
          avgMessagesPerSession: { $avg: "$messageCount" },
        },
      },
    ]);
    const weeklyMessageCount = weeklySessionAgg[0]?.weeklyMessageCount || 0;
    const avgMessagesPerSession = Math.round(weeklySessionAgg[0]?.avgMessagesPerSession || 0);

    // ── Users growth (last 7 days) ──
    const usersGrowth = await User.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── Sessions per day (last 7 days) ──
    const sessionsPerDay = await ChatSession.aggregate([
      { $match: { startTime: { $gte: sevenDaysAgo }, "messages.0": { $exists: true } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$startTime" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── Emergency trends (last 7 days) ──
    const emergencyTrends = await EscalationLog.aggregate([
      { $match: { createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // ── Average mood score ──
    const moodAgg = await Mood.aggregate([
      { $match: { timestamp: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: null,
          avgScore: { $avg: "$score" },
          count: { $sum: 1 },
        },
      },
    ]);
    const avgMoodScore = Math.round(moodAgg[0]?.avgScore || 0);

    const previousWeekMoodAgg = await Mood.aggregate([
      { $match: { timestamp: { $gte: fourteenDaysAgo, $lt: sevenDaysAgo } } },
      {
        $group: {
          _id: null,
          avgScore: { $avg: "$score" },
        },
      },
    ]);
    const previousWeekAvgMoodScore = Math.round(previousWeekMoodAgg[0]?.avgScore || 0);

    // â”€â”€ Weekly mood outcomes â”€â”€
    const weeklyMoodOutcomeAgg = await Mood.aggregate([
      { $match: { timestamp: { $gte: sevenDaysAgo } } },
      { $sort: { userId: 1, timestamp: 1 } },
      {
        $group: {
          _id: "$userId",
          firstScore: { $first: "$score" },
          latestScore: { $last: "$score" },
          checkIns: { $sum: 1 },
        },
      },
      { $match: { checkIns: { $gte: 2 } } },
      {
        $project: {
          firstScore: 1,
          latestScore: 1,
          moodChange: { $subtract: ["$latestScore", "$firstScore"] },
        },
      },
      {
        $group: {
          _id: null,
          outcomeTrackedUsers: { $sum: 1 },
          benefitedUsersThisWeek: {
            $sum: { $cond: [{ $gte: ["$moodChange", 5] }, 1, 0] },
          },
          notRecoveredUsersThisWeek: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $lt: ["$latestScore", 50] },
                    { $lt: ["$moodChange", 5] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          needsFollowUpUsers: {
            $sum: { $cond: [{ $lt: ["$latestScore", 50] }, 1, 0] },
          },
          averageMoodChange: { $avg: "$moodChange" },
        },
      },
    ]);
    const weeklyMoodOutcome = weeklyMoodOutcomeAgg[0] || {};
    const outcomeTrackedUsers = weeklyMoodOutcome.outcomeTrackedUsers || 0;
    const benefitedUsersThisWeek = weeklyMoodOutcome.benefitedUsersThisWeek || 0;
    const notRecoveredUsersThisWeek = weeklyMoodOutcome.notRecoveredUsersThisWeek || 0;
    const needsFollowUpUsers = weeklyMoodOutcome.needsFollowUpUsers || 0;
    const averageMoodChange = Number((weeklyMoodOutcome.averageMoodChange || 0).toFixed(1));
    const recoveryRate = outcomeTrackedUsers > 0
      ? Math.round((benefitedUsersThisWeek / outcomeTrackedUsers) * 100)
      : 0;
    const weeklyActivityCompletionRate = weeklyActivities > 0
      ? Math.round((weeklyCompletedActivities / weeklyActivities) * 100)
      : 0;

    const activityBreakdown = await Activity.aggregate([
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
    ]);

    res.json({
      metrics: {
        totalUsers,
        newUsersThisWeek,
        newUsersThisMonth,
        totalSessions,
        activeSessions,
        avgSessionMinutes,
        totalEscalations,
        escalationsThisWeek,
        totalActivities,
        totalMoodEntries,
        avgMoodScore,
        weeklyActiveUsers,
        weeklySessions,
        weeklyCompletedSessions,
        weeklyActivities,
        weeklyCompletedActivities,
        weeklyActivityCompletionRate,
        weeklyHighRiskSessions,
        weeklyMessageCount,
        avgMessagesPerSession,
        previousWeekAvgMoodScore,
        outcomeTrackedUsers,
        benefitedUsersThisWeek,
        notRecoveredUsersThisWeek,
        needsFollowUpUsers,
        averageMoodChange,
        recoveryRate,
      },
      trends: {
        usersGrowth,
        sessionsPerDay,
        emergencyTrends,
        activityBreakdown,
      },
    });
  } catch (error) {
    logger.error("[ADMIN_ANALYTICS] Analytics error", { error: String(error) });
    res.status(500).json({ message: "Failed to compute analytics" });
  }
});

export default router;
