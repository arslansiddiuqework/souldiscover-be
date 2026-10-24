/**
 * Admin Users Routes
 * ──────────────────
 * Read-only + moderation access to the User collection.
 * NEVER modifies user auth flow, therapy workflow, or AI pipeline.
 *
 * GET    /api/admin/users           — List all users (paginated, searchable)
 * GET    /api/admin/users/:id       — Get single user detail
 * PATCH  /api/admin/users/:id/block — Block a user
 * PATCH  /api/admin/users/:id/unblock — Unblock a user
 * DELETE /api/admin/users/:id       — Delete a user
 */

import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../../models/User";
import { ChatSession } from "../../models/ChatSession";
import { EmergencyContact } from "../../models/EmergencyContact";
import { EscalationLog } from "../../models/EscalationLog";
import { Mood } from "../../models/Mood";
import { Activity } from "../../models/Activity";
import { WellnessPlan } from "../../models/WellnessPlan";
import { Consultation } from "../../models/Consultation";
import { AssessmentResult } from "../../models/AssessmentResult";
import { AssessmentSession } from "../../models/AssessmentSession";
import { AiUsageCounter } from "../../models/AiUsageCounter";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import {
  USER_MONTHLY_LIMIT,
  utcMonthKey,
} from "../../services/aiQuota.service";
import { logger } from "../../utils/logger";
import { recordSecurityEvent } from "../../services/securityAudit.service";
import { requireAdminPassword } from "../../middleware/requireAdminPassword";

const router = Router();
router.use(adminAuth);

// ── GET / — List users ────────────────────────────────────────────────────────
router.get("/", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";
    const skip = (page - 1) * limit;

    // Build filter
    const filter: Record<string, any> = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    
    if (status && status !== "all") {
      filter.status = status;
    }

    const [users, total] = await Promise.all([
      User.find(filter).select("-password").sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    // Enrich each user with session count and emergency flag
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const [sessionCount, emergencyRecord, lastEscalation] = await Promise.all([
          ChatSession.countDocuments({ userId: user._id }),
          EmergencyContact.findOne({ userId: user._id }),
          EscalationLog.findOne({ userId: user._id }).sort({ createdAt: -1 }),
        ]);

        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.profileImage,
          aiName: user.aiName,
          aiBehavior: user.aiBehavior,
          authProvider: user.authProvider || "local",
          status: user.status || "active",
          createdAt: (user as any).createdAt,
          updatedAt: (user as any).updatedAt,
          sessionCount,
          hasEmergencyContacts: (emergencyRecord?.contacts?.length || 0) > 0,
          emergencyContactCount: emergencyRecord?.contacts?.length || 0,
          consentAccepted: emergencyRecord?.consentAccepted || false,
          lastEscalation: lastEscalation
            ? {
                riskLevel: lastEscalation.riskLevel,
                outcome: lastEscalation.outcome,
                createdAt: lastEscalation.createdAt,
              }
            : null,
        };
      })
    );

    res.json({
      users: enrichedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("[ADMIN_USERS] List users error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// ── GET /:id — Single user detail ─────────────────────────────────────────────
router.get("/:id", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [
      sessions,
      emergencyRecord,
      escalationLogs,
      moodCount,
      recentMoods,
      moodAvgAgg,
      activityCount,
      recentActivities,
      wellnessPlans,
      consultations,
      assessmentCount,
      recentAssessments,
      assessmentInProgress,
      aiUsageDoc,
    ] = await Promise.all([
      ChatSession.find({ userId: user._id })
        .select("sessionId title startTime status messages")
        .sort({ startTime: -1 })
        .limit(20),
      EmergencyContact.findOne({ userId: user._id }),
      EscalationLog.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10),
      Mood.countDocuments({ userId: user._id }),
      Mood.find({ userId: user._id }).sort({ timestamp: -1 }).limit(7),
      Mood.aggregate([
        { $match: { userId: user._id, timestamp: { $gte: sevenDaysAgo } } },
        { $group: { _id: null, avg: { $avg: "$score" }, count: { $sum: 1 } } },
      ]),
      Activity.countDocuments({ userId: user._id }),
      Activity.find({ userId: user._id }).sort({ timestamp: -1 }).limit(10),
      WellnessPlan.find({ userId: user._id })
        .select("planId title catalogSlug status completionRate currentStreak tasksCompleted tasksTotal updatedAt")
        .sort({ updatedAt: -1 })
        .limit(10),
      Consultation.find({ userId: user._id })
        .select("bookingId psychologistName date time status paymentStatus reason createdAt")
        .sort({ date: -1 })
        .limit(10),
      AssessmentResult.countDocuments({ userId: user._id, saved: true }),
      AssessmentResult.find({ userId: user._id, saved: true })
        .sort({ completedAt: -1 })
        .limit(8)
        .select(
          "resultId assessmentSlug title instrumentVersion summary scoring completedAt"
        )
        .lean(),
      AssessmentSession.countDocuments({
        userId: user._id,
        status: "in_progress",
      }),
      AiUsageCounter.findOne({
        scope: "user_month",
        periodKey: `${user._id}:${utcMonthKey()}`,
      }).lean(),
    ]);

    const sessionsWithCounts = sessions.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      startTime: s.startTime,
      status: s.status,
      messageCount: s.messages.length,
    }));

    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage,
        aiName: user.aiName,
        aiBehavior: user.aiBehavior,
        authProvider: user.authProvider || "local",
        status: user.status || "active",
        createdAt: (user as any).createdAt,
      },
      aiUsage: {
        monthKey: utcMonthKey(),
        count: aiUsageDoc?.count || 0,
        limit: USER_MONTHLY_LIMIT,
        remaining: Math.max(0, USER_MONTHLY_LIMIT - (aiUsageDoc?.count || 0)),
      },
      sessions: sessionsWithCounts,
      emergencyContacts: emergencyRecord?.contacts || [],
      consentAccepted: emergencyRecord?.consentAccepted || false,
      escalationSettings: emergencyRecord?.escalationSettings || null,
      escalationLogs,
      mood: {
        totalEntries: moodCount,
        weeklyAvgScore: Math.round(moodAvgAgg[0]?.avg || 0),
        weeklyEntries: moodAvgAgg[0]?.count || 0,
        recent: recentMoods.map((m) => ({
          score: m.score,
          mood: m.mood,
          source: m.source,
          note: m.note,
          timestamp: m.timestamp,
        })),
      },
      activity: {
        totalEntries: activityCount,
        recent: recentActivities.map((a) => ({
          type: a.type,
          name: a.name,
          duration: a.duration,
          completed: a.completed,
          timestamp: a.timestamp,
        })),
      },
      wellnessPlans,
      consultations,
      assessments: {
        totalCompletions: assessmentCount,
        inProgressSessions: assessmentInProgress,
        recent: recentAssessments.map((r) => {
          const scoring = (r.scoring || {}) as Record<string, unknown>;
          return {
            resultId: r.resultId,
            assessmentSlug: r.assessmentSlug,
            title: r.title,
            instrumentVersion: r.instrumentVersion,
            summary: r.summary,
            interpretationLabel:
              typeof scoring.interpretationLabel === "string"
                ? scoring.interpretationLabel
                : null,
            scoringMethod:
              typeof scoring.scoringMethod === "string"
                ? scoring.scoringMethod
                : null,
            totalScore:
              typeof scoring.totalScore === "number" ? scoring.totalScore : null,
            maxScore:
              typeof scoring.maxScore === "number" ? scoring.maxScore : null,
            completedAt: r.completedAt,
          };
        }),
      },
    });
  } catch (error) {
    logger.error("[ADMIN_USERS] Get user detail error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch user details" });
  }
});

// ── PATCH /:id/status — Change user status ────────────────────────────────────
router.patch("/:id/status", requirePermission("users.block"), async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    const { status } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be active or suspended." });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    logger.info("[ADMIN_USERS] User status updated", {
      userId: req.params.id,
      status,
      adminId: String(req.admin!._id),
    });

    recordSecurityEvent({
      category: "ADMIN",
      severity: status === "suspended" ? "WARNING" : "INFO",
      action: "user_status_change",
      description: `Admin set user status to ${status}.`,
      actorType: "admin",
      actorId: req.admin!._id,
      email: user.email,
      req,
      meta: { targetUserId: req.params.id, status },
    });

    res.json({ message: "User status updated successfully", user });
  } catch (error) {
    logger.error("[ADMIN_USERS] Update user status error", { error: String(error) });
    res.status(500).json({ message: "Failed to update user status" });
  }
});

// ── DELETE /:id — Delete user (requires step-up password) ─────────────────────
router.delete(
  "/:id",
  requirePermission("users.delete"),
  requireAdminPassword,
  async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Clean up related data (including Assessment Center records)
    await Promise.all([
      ChatSession.deleteMany({ userId: user._id }),
      EmergencyContact.deleteMany({ userId: user._id }),
      EscalationLog.deleteMany({ userId: user._id }),
      Mood.deleteMany({ userId: user._id }),
      Activity.deleteMany({ userId: user._id }),
      WellnessPlan.deleteMany({ userId: user._id }),
      Consultation.deleteMany({ userId: user._id }),
      AssessmentResult.deleteMany({ userId: user._id }),
      AssessmentSession.deleteMany({ userId: user._id }),
    ]);

    logger.info("[ADMIN_USERS] User deleted", { userId: req.params.id, adminId: String(req.admin!._id) });

    recordSecurityEvent({
      category: "ADMIN",
      severity: "CRITICAL",
      action: "user_deleted",
      description: "Admin deleted a user and associated data.",
      actorType: "admin",
      actorId: req.admin!._id,
      email: user.email,
      req,
      meta: { targetUserId: req.params.id },
    });

    res.json({ message: "User and associated data deleted successfully" });
  } catch (error) {
    logger.error("[ADMIN_USERS] Delete user error", { error: String(error) });
    res.status(500).json({ message: "Failed to delete user" });
  }
});

export default router;
