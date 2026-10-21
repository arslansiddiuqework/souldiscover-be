/**
 * Admin Assessment Center management.
 * Individual response content is not exposed in list views.
 * Scoring rule changes require a new instrument version (catalog is versioned in code).
 */

import { Router, Request, Response } from "express";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import {
  ASSESSMENT_CATALOG,
  getAssessmentBySlug,
  listAssessments,
  toOverview,
} from "../../assessments/catalog";
import { AssessmentResult } from "../../models/AssessmentResult";
import { AssessmentSession } from "../../models/AssessmentSession";
import { User } from "../../models/User";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

function scoringSummary(scoring: Record<string, unknown> | null | undefined) {
  if (!scoring || typeof scoring !== "object") {
    return {
      interpretationLabel: null as string | null,
      scoringMethod: null as string | null,
      totalScore: null as number | null,
      maxScore: null as number | null,
      clinicallyValidated: false,
    };
  }
  return {
    interpretationLabel:
      typeof scoring.interpretationLabel === "string"
        ? scoring.interpretationLabel
        : null,
    scoringMethod:
      typeof scoring.scoringMethod === "string" ? scoring.scoringMethod : null,
    totalScore:
      typeof scoring.totalScore === "number" ? scoring.totalScore : null,
    maxScore: typeof scoring.maxScore === "number" ? scoring.maxScore : null,
    clinicallyValidated: Boolean(scoring.clinicallyValidated),
  };
}

/**
 * Recent completions across users — metadata only (no answer payloads).
 * Must be registered before /:slug.
 */
router.get(
  "/results",
  requirePermission("users.read"),
  async (req: Request, res: Response) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page), 10) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit), 10) || 20));
      const slug = (req.query.slug as string) || "";
      const userId = (req.query.userId as string) || "";
      const skip = (page - 1) * limit;

      const filter: Record<string, unknown> = { saved: true };
      if (slug) filter.assessmentSlug = slug;
      if (userId) filter.userId = userId;

      const [rows, total, inProgress, abandoned] = await Promise.all([
        AssessmentResult.find(filter)
          .sort({ completedAt: -1 })
          .skip(skip)
          .limit(limit)
          .select(
            "resultId userId assessmentSlug title instrumentVersion summary scoring completedAt saved"
          )
          .lean(),
        AssessmentResult.countDocuments(filter),
        AssessmentSession.countDocuments({ status: "in_progress" }),
        AssessmentSession.countDocuments({ status: "abandoned" }),
      ]);

      const userIds = [...new Set(rows.map((r) => String(r.userId)))];
      const users = await User.find({ _id: { $in: userIds } })
        .select("name email")
        .lean();
      const userMap = new Map(users.map((u) => [String(u._id), u]));

      res.json({
        results: rows.map((r) => {
          const user = userMap.get(String(r.userId));
          const score = scoringSummary(r.scoring as Record<string, unknown>);
          return {
            resultId: r.resultId,
            assessmentSlug: r.assessmentSlug,
            title: r.title,
            instrumentVersion: r.instrumentVersion,
            summary: r.summary,
            completedAt: r.completedAt,
            user: user
              ? { id: String(r.userId), name: user.name, email: user.email }
              : { id: String(r.userId), name: "Unknown", email: "" },
            ...score,
          };
        }),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit) || 1,
        },
        funnel: {
          inProgressSessions: inProgress,
          abandonedSessions: abandoned,
        },
        note: "Answer payloads are omitted. Use user history in the main app for private reflection content.",
      });
    } catch (error) {
      logger.error("[ADMIN_ASSESSMENTS] Results list error", {
        error: String(error),
      });
      res.status(500).json({ message: "Failed to load assessment results" });
    }
  }
);

router.get("/", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "all";
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;

    let items = listAssessments({ search, status, includeComingSoon: true });
    const total = items.length;
    const start = (page - 1) * limit;
    items = items.slice(start, start + limit);

    const usage = await AssessmentResult.aggregate([
      { $group: { _id: "$assessmentSlug", count: { $sum: 1 } } },
    ]);
    const usageMap = new Map(usage.map((u) => [u._id, u.count]));

    const statusCounts = {
      published: ASSESSMENT_CATALOG.filter((a) => a.status === "published").length,
      coming_soon: ASSESSMENT_CATALOG.filter((a) => a.status === "coming_soon").length,
      draft: ASSESSMENT_CATALOG.filter((a) => a.status === "draft").length,
      archived: ASSESSMENT_CATALOG.filter((a) => a.status === "archived").length,
    };

    const totalCompletions = await AssessmentResult.countDocuments();

    res.json({
      assessments: items.map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        version: a.version,
        status: a.status,
        category: a.category,
        typeBadge: a.typeBadge,
        clinicallyValidated: a.clinicallyValidated,
        licenseSource: a.license.source,
        licenseNotes: a.license.notes,
        questionCount: a.questionCount,
        completions: usageMap.get(a.slug) || 0,
        effectiveDate: a.effectiveDate,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary: {
        ...statusCounts,
        totalCompletions,
      },
    });
  } catch (error) {
    logger.error("[ADMIN_ASSESSMENTS] List error", { error: String(error) });
    res.status(500).json({ message: "Failed to load assessments" });
  }
});

router.get("/:slug", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    const def = getAssessmentBySlug(req.params.slug);
    if (!def) {
      return res.status(404).json({ message: "Assessment not found" });
    }

    const completions = await AssessmentResult.countDocuments({
      assessmentSlug: def.slug,
    });

    // Metadata + question structure for admin review — not individual user answers
    res.json({
      assessment: {
        ...toOverview(def),
        longDescription: def.longDescription,
        scoringMethod: def.scoringMethod,
        license: def.license,
        recommendations: def.recommendations,
        questions: def.questions.map((q) => ({
          id: q.id,
          text: q.text,
          required: q.required,
          allowSkip: q.allowSkip,
          responseType: q.responseType,
          optionCount: q.options.length,
          domain: q.domain,
          showIf: q.showIf,
        })),
        reflectionDomains: def.reflectionDomains,
        thresholds: def.thresholds,
        completions,
        note:
          "Individual mental health responses are not accessible here by default. To change scoring rules, publish a new instrument version in code; do not silently alter a published version.",
      },
    });
  } catch (error) {
    logger.error("[ADMIN_ASSESSMENTS] Detail error", { error: String(error) });
    res.status(500).json({ message: "Failed to load assessment detail" });
  }
});

export default router;
