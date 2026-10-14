/**
 * User Wellness Plan Routes
 * Syncs client-generated plans so admin can track enrollments & progress.
 */

import { Router, Request, Response } from "express";
import { auth } from "../middleware/auth";
import { WellnessPlan, computeTaskStats } from "../models/WellnessPlan";
import { logger } from "../utils/logger";

const router = Router();
router.use(auth);

function toClientPlan(doc: InstanceType<typeof WellnessPlan>) {
  const data = (doc.planData || {}) as Record<string, unknown>;
  return {
    ...data,
    id: doc.planId,
    userId: String(doc.userId),
    catalogSlug: doc.catalogSlug,
    title: doc.title,
    primaryGoal: doc.primaryGoal,
    status: doc.status,
    challengeLevel: doc.challengeLevel,
    durationDays: doc.durationDays,
    currentStreak: doc.currentStreak,
    longestStreak: doc.longestStreak,
    createdAt: data.createdAt || doc.createdAt?.toISOString?.() || doc.createdAt,
    updatedAt: data.updatedAt || doc.updatedAt?.toISOString?.() || doc.updatedAt,
    _meta: {
      completionRate: doc.completionRate,
      tasksCompleted: doc.tasksCompleted,
      tasksTotal: doc.tasksTotal,
    },
  };
}

// GET / — list enrollments for current user
router.get("/", async (req: Request, res: Response) => {
  try {
    const plans = await WellnessPlan.find({ userId: req.user!._id }).sort({ updatedAt: -1 });
    res.json({
      enrollments: plans.map(toClientPlan),
      activeEnrollmentId:
        plans.find((p) => p.status === "active")?.planId ||
        plans[0]?.planId ||
        null,
    });
  } catch (error) {
    logger.error("[WELLNESS] List error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch wellness plans" });
  }
});

// PUT / — upsert full plan payload from client
router.put("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body?.id || !body?.title || !body?.primaryGoal) {
      return res.status(400).json({ message: "id, title, and primaryGoal are required" });
    }

    const stats = computeTaskStats(body);
    const plan = await WellnessPlan.findOneAndUpdate(
      { userId: req.user!._id, planId: body.id },
      {
        planId: body.id,
        userId: req.user!._id,
        catalogSlug: body.catalogSlug,
        title: body.title,
        primaryGoal: body.primaryGoal,
        status: body.status || "active",
        challengeLevel: body.challengeLevel || "standard",
        durationDays: body.durationDays || 21,
        currentStreak: body.currentStreak || 0,
        longestStreak: body.longestStreak || 0,
        assessment: body.assessment || {},
        planData: body,
        ...stats,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ plan: toClientPlan(plan!), message: "Wellness plan synced" });
  } catch (error) {
    logger.error("[WELLNESS] Upsert error", { error: String(error) });
    res.status(500).json({ message: "Failed to sync wellness plan" });
  }
});

// PUT /bulk — sync full enrollment store (must be before /:planId)
router.put("/bulk", async (req: Request, res: Response) => {
  try {
    const enrollments = Array.isArray(req.body?.enrollments) ? req.body.enrollments : [];
    const results = [];

    for (const body of enrollments) {
      if (!body?.id) continue;
      const stats = computeTaskStats(body);
      const plan = await WellnessPlan.findOneAndUpdate(
        { userId: req.user!._id, planId: body.id },
        {
          planId: body.id,
          userId: req.user!._id,
          catalogSlug: body.catalogSlug,
          title: body.title || "Wellness Plan",
          primaryGoal: body.primaryGoal || "custom",
          status: body.status || "active",
          challengeLevel: body.challengeLevel || "standard",
          durationDays: body.durationDays || 21,
          currentStreak: body.currentStreak || 0,
          longestStreak: body.longestStreak || 0,
          assessment: body.assessment || {},
          planData: body,
          ...stats,
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      results.push(toClientPlan(plan!));
    }

    res.json({
      enrollments: results,
      activeEnrollmentId: req.body?.activeEnrollmentId || null,
      message: "Wellness plans synced",
    });
  } catch (error) {
    logger.error("[WELLNESS] Bulk sync error", { error: String(error) });
    res.status(500).json({ message: "Failed to sync wellness plans" });
  }
});

// GET /:planId
router.get("/:planId", async (req: Request, res: Response) => {
  try {
    const plan = await WellnessPlan.findOne({
      userId: req.user!._id,
      planId: req.params.planId,
    });
    if (!plan) return res.status(404).json({ message: "Plan not found" });
    res.json({ plan: toClientPlan(plan) });
  } catch (error) {
    logger.error("[WELLNESS] Get error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch wellness plan" });
  }
});

// DELETE /:planId
router.delete("/:planId", async (req: Request, res: Response) => {
  try {
    const deleted = await WellnessPlan.findOneAndDelete({
      userId: req.user!._id,
      planId: req.params.planId,
    });
    if (!deleted) return res.status(404).json({ message: "Plan not found" });
    res.json({ message: "Wellness plan deleted" });
  } catch (error) {
    logger.error("[WELLNESS] Delete error", { error: String(error) });
    res.status(500).json({ message: "Failed to delete wellness plan" });
  }
});

export default router;
