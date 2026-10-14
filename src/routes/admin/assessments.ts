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
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

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
