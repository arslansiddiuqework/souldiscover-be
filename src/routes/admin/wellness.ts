/**
 * Admin Wellness Plan Routes
 * Track user wellness enrollments and progress.
 */

import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { WellnessPlan } from "../../models/WellnessPlan";
import { User } from "../../models/User";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

router.get("/", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (status && status !== "all") filter.status = status;

    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      const userIds = users.map((u) => u._id);
      filter.$or = [
        { userId: { $in: userIds } },
        { title: { $regex: search, $options: "i" } },
        { catalogSlug: { $regex: search, $options: "i" } },
        { primaryGoal: { $regex: search, $options: "i" } },
      ];
    }

    const [plans, total, statusCounts, avgCompletion] = await Promise.all([
      WellnessPlan.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
      WellnessPlan.countDocuments(filter),
      WellnessPlan.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      WellnessPlan.aggregate([
        { $group: { _id: null, avg: { $avg: "$completionRate" } } },
      ]),
    ]);

    const userIds = [...new Set(plans.map((p) => String(p.userId)))];
    const users = await User.find({ _id: { $in: userIds } }).select(
      "name email profileImage"
    );
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const enriched = plans.map((p) => {
      const user = userMap.get(String(p.userId));
      return {
        _id: p._id,
        planId: p.planId,
        title: p.title,
        catalogSlug: p.catalogSlug,
        primaryGoal: p.primaryGoal,
        status: p.status,
        challengeLevel: p.challengeLevel,
        durationDays: p.durationDays,
        currentStreak: p.currentStreak,
        longestStreak: p.longestStreak,
        completionRate: p.completionRate,
        tasksCompleted: p.tasksCompleted,
        tasksTotal: p.tasksTotal,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        user: user
          ? {
              _id: user._id,
              name: user.name,
              email: user.email,
              profileImage: user.profileImage,
            }
          : null,
      };
    });

    const counts: Record<string, number> = { active: 0, completed: 0, paused: 0 };
    for (const row of statusCounts) {
      counts[row._id] = row.count;
    }

    res.json({
      plans: enriched,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary: {
        totalEnrollments: await WellnessPlan.countDocuments(),
        active: counts.active || 0,
        completed: counts.completed || 0,
        paused: counts.paused || 0,
        avgCompletionRate: Math.round(avgCompletion[0]?.avg || 0),
      },
    });
  } catch (error) {
    logger.error("[ADMIN_WELLNESS] List error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch wellness plans" });
  }
});

router.get("/:id", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid plan ID" });
    }
    const plan = await WellnessPlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ message: "Plan not found" });

    const user = await User.findById(plan.userId).select(
      "name email profileImage aiName aiBehavior"
    );

    res.json({
      plan: {
        _id: plan._id,
        planId: plan.planId,
        title: plan.title,
        catalogSlug: plan.catalogSlug,
        primaryGoal: plan.primaryGoal,
        status: plan.status,
        challengeLevel: plan.challengeLevel,
        durationDays: plan.durationDays,
        currentStreak: plan.currentStreak,
        longestStreak: plan.longestStreak,
        completionRate: plan.completionRate,
        tasksCompleted: plan.tasksCompleted,
        tasksTotal: plan.tasksTotal,
        assessment: plan.assessment,
        planData: plan.planData,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
      },
      user,
    });
  } catch (error) {
    logger.error("[ADMIN_WELLNESS] Detail error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch wellness plan detail" });
  }
});

export default router;
