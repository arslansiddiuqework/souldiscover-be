/**
 * Assessment Center — user-facing APIs.
 * Catalog is public. Saved history and owned results require auth.
 * Sensitive answers are never logged.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { auth } from "../middleware/auth";
import { optionalAuth } from "../middleware/optionalAuth";
import {
  getAssessmentBySlug,
  listAssessments,
  toOverview,
  toPublicCard,
  toTakePayload,
} from "../assessments/catalog";
import { scoreAssessment, validateAnswers } from "../assessments/scoring/engine";
import { getCrisisSupportPayload } from "../assessments/crisis-resources";
import { AssessmentResult } from "../models/AssessmentResult";
import { AssessmentSession } from "../models/AssessmentSession";
import { AnswerPayload } from "../assessments/types";
import { logger } from "../utils/logger";

const router = Router();

function newId(prefix: string) {
  return `${prefix}_${crypto.randomBytes(12).toString("hex")}`;
}

function sanitizeAnswers(raw: unknown): AnswerPayload[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => ({
    questionId: String(item?.questionId || ""),
    value: item?.value ?? null,
    skipped: Boolean(item?.skipped),
  }));
}

function recommendationPayload(def: ReturnType<typeof getAssessmentBySlug>, scoring: ReturnType<typeof scoreAssessment>) {
  if (!def) return [];
  const slugs = new Set(scoring.suggestedPlanSlugs || []);
  return def.recommendations
    .filter((r) => slugs.has(r.planSlug))
    .map((r) => ({
      planSlug: r.planSlug,
      reason: r.reason,
      href: `/wellness-plan?plan=${encodeURIComponent(r.planSlug)}`,
    }));
}

// GET /crisis-support — public
router.get("/crisis-support", (_req: Request, res: Response) => {
  res.json(getCrisisSupportPayload());
});

// GET / — public catalog
router.get("/", optionalAuth, (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || "";
    const category = (req.query.category as string) || "all";
    const status = (req.query.status as string) || "all";
    const includeComingSoon = req.query.includeComingSoon !== "false";

    const items = listAssessments({ search, category, status, includeComingSoon })
      .filter((a) => a.slug !== "starting-point-finder")
      .map(toPublicCard);

    const featured = getAssessmentBySlug("starting-point-finder");

    res.json({
      featured: featured
        ? {
            ...toPublicCard(featured),
            headline: "Not sure where to start?",
            cta: "Find a starting point",
          }
        : null,
      assessments: items,
      categories: [
        { id: "all", label: "All" },
        { id: "emotional_wellbeing", label: "Emotional well-being" },
        { id: "focus_functioning", label: "Focus and daily functioning" },
        { id: "thoughts_behaviors", label: "Thoughts and behaviors" },
        { id: "trauma_specialist", label: "Trauma and specialist" },
        { id: "general", label: "General" },
      ],
      trust: [
        "Free self-assessments.",
        "Take your time; you can pause whenever you need to.",
        "Your results are personal.",
        "Screening results are not a diagnosis.",
      ],
      crisis: getCrisisSupportPayload(),
    });
  } catch (error) {
    logger.error("[ASSESSMENT] Catalog error", { error: String(error) });
    res.status(500).json({ message: "Failed to load assessments" });
  }
});

// GET /history — auth required (before /:slug)
router.get("/history", auth, async (req: Request, res: Response) => {
  try {
    const results = await AssessmentResult.find({
      userId: req.user!._id,
      saved: true,
    })
      .sort({ completedAt: -1 })
      .select(
        "resultId assessmentSlug title instrumentVersion summary scoring.interpretationLabel scoring.clinicallyValidated scoring.totalScore scoring.maxScore scoring.scoringMethod completedAt"
      )
      .lean();

    res.json({
      history: results.map((r) => {
        const scoring = (r.scoring || {}) as {
          interpretationLabel?: unknown;
          clinicallyValidated?: unknown;
          totalScore?: unknown;
          maxScore?: unknown;
          scoringMethod?: unknown;
        };
        return {
          resultId: r.resultId,
          assessmentSlug: r.assessmentSlug,
          title: r.title,
          instrumentVersion: r.instrumentVersion,
          summary: r.summary,
          interpretationLabel:
            typeof scoring.interpretationLabel === "string" ? scoring.interpretationLabel : null,
          clinicallyValidated: Boolean(scoring.clinicallyValidated),
          totalScore: typeof scoring.totalScore === "number" ? scoring.totalScore : null,
          maxScore: typeof scoring.maxScore === "number" ? scoring.maxScore : null,
          scoringMethod: typeof scoring.scoringMethod === "string" ? scoring.scoringMethod : null,
          completedAt: r.completedAt,
        };
      }),
    });
  } catch (error) {
    logger.error("[ASSESSMENT] History error", { error: String(error) });
    res.status(500).json({ message: "Failed to load assessment history" });
  }
});

// GET /results/:resultId — ownership enforced
router.get("/results/:resultId", auth, async (req: Request, res: Response) => {
  try {
    const result = await AssessmentResult.findOne({
      resultId: req.params.resultId,
      userId: req.user!._id,
    }).lean();

    if (!result) {
      return res.status(404).json({ message: "Result not found" });
    }

    const def = getAssessmentBySlug(result.assessmentSlug);
    res.json({
      resultId: result.resultId,
      assessmentSlug: result.assessmentSlug,
      title: result.title,
      instrumentVersion: result.instrumentVersion,
      completedAt: result.completedAt,
      saved: result.saved,
      scoring: result.scoring,
      summary: result.summary,
      recommendations: recommendationPayload(def, result.scoring as any),
      primaryNextStep: def?.primaryNextStep,
      crisis: getCrisisSupportPayload(),
      license: def
        ? {
            source: def.license.source,
            clinicallyValidated: def.license.clinicallyValidated,
            notes: def.license.notes,
          }
        : null,
    });
  } catch (error) {
    logger.error("[ASSESSMENT] Get result error", { error: String(error) });
    res.status(500).json({ message: "Failed to load result" });
  }
});

// DELETE /results/:resultId
router.delete("/results/:resultId", auth, async (req: Request, res: Response) => {
  try {
    const deleted = await AssessmentResult.findOneAndDelete({
      resultId: req.params.resultId,
      userId: req.user!._id,
    });
    if (!deleted) {
      return res.status(404).json({ message: "Result not found" });
    }
    res.json({ message: "Result deleted" });
  } catch (error) {
    logger.error("[ASSESSMENT] Delete result error", { error: String(error) });
    res.status(500).json({ message: "Failed to delete result" });
  }
});

// GET /:slug — overview
router.get("/:slug", optionalAuth, (req: Request, res: Response) => {
  try {
    const def = getAssessmentBySlug(req.params.slug);
    if (!def || def.status === "archived") {
      return res.status(404).json({ message: "Assessment not found" });
    }
    res.json({
      assessment: toOverview(def),
      crisis: getCrisisSupportPayload(),
    });
  } catch (error) {
    logger.error("[ASSESSMENT] Overview error", { error: String(error) });
    res.status(500).json({ message: "Failed to load assessment" });
  }
});

// GET /:slug/take — question payload for published assessments
router.get("/:slug/take", optionalAuth, (req: Request, res: Response) => {
  try {
    const def = getAssessmentBySlug(req.params.slug);
    if (!def) {
      return res.status(404).json({ message: "Assessment not found" });
    }
    const payload = toTakePayload(def);
    if (!payload) {
      return res.status(403).json({
        message:
          def.status === "coming_soon"
            ? "This assessment is coming soon pending licensing and clinical review."
            : "This assessment cannot be started.",
        status: def.status,
      });
    }
    res.json({
      assessment: payload,
      crisis: getCrisisSupportPayload(),
    });
  } catch (error) {
    logger.error("[ASSESSMENT] Take payload error", { error: String(error) });
    res.status(500).json({ message: "Failed to load assessment questions" });
  }
});

// POST /:slug/sessions — start session (optional auth)
router.post("/:slug/sessions", optionalAuth, async (req: Request, res: Response) => {
  try {
    const def = getAssessmentBySlug(req.params.slug);
    if (!def || def.status !== "published" || def.questions.length === 0) {
      return res.status(403).json({
        message: "This assessment cannot be started yet.",
      });
    }

    if (def.requiresAcknowledgment && !req.body?.acknowledgedNotDiagnosis) {
      return res.status(400).json({
        message: "Please acknowledge that this assessment is not a diagnosis.",
      });
    }

    const sessionId = newId("asess");
    const submissionToken = crypto.randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await AssessmentSession.create({
      sessionId,
      userId: req.user?._id,
      assessmentId: def.id,
      assessmentSlug: def.slug,
      instrumentVersion: def.version,
      status: "in_progress",
      answers: [],
      acknowledgedNotDiagnosis: Boolean(req.body?.acknowledgedNotDiagnosis),
      submissionToken,
      expiresAt,
    });

    res.status(201).json({
      sessionId,
      submissionToken,
      instrumentVersion: def.version,
      expiresAt,
    });
  } catch (error) {
    logger.error("[ASSESSMENT] Start session error", { error: String(error) });
    res.status(500).json({ message: "Failed to start assessment session" });
  }
});

// PUT /:slug/sessions/:sessionId — save progress
router.put(
  "/:slug/sessions/:sessionId",
  optionalAuth,
  async (req: Request, res: Response) => {
    try {
      const session = await AssessmentSession.findOne({
        sessionId: req.params.sessionId,
        assessmentSlug: req.params.slug,
        status: "in_progress",
      });

      if (!session) {
        return res.status(404).json({ message: "Session not found" });
      }

      if (session.userId && req.user && String(session.userId) !== String(req.user._id)) {
        return res.status(403).json({ message: "Not allowed" });
      }

      if (session.expiresAt.getTime() < Date.now()) {
        session.status = "abandoned";
        await session.save();
        return res.status(410).json({ message: "Session expired" });
      }

      const answers = sanitizeAnswers(req.body?.answers);
      session.answers = answers as any;
      if (req.body?.currentQuestionId) {
        session.currentQuestionId = String(req.body.currentQuestionId);
      }
      await session.save();

      res.json({ message: "Progress saved", sessionId: session.sessionId });
    } catch (error) {
      logger.error("[ASSESSMENT] Save progress error", { error: String(error) });
      res.status(500).json({ message: "Failed to save progress" });
    }
  }
);

// POST /:slug/submit — score + optionally persist
router.post("/:slug/submit", optionalAuth, async (req: Request, res: Response) => {
  try {
    const def = getAssessmentBySlug(req.params.slug);
    if (!def || def.status !== "published" || def.questions.length === 0) {
      return res.status(403).json({ message: "This assessment cannot be submitted." });
    }

    const answers = sanitizeAnswers(req.body?.answers);
    const validation = validateAnswers(def, answers);
    if (!validation.ok) {
      return res.status(400).json({ message: validation.message });
    }

    if (def.requiresAcknowledgment && !req.body?.acknowledgedNotDiagnosis) {
      return res.status(400).json({
        message: "Please acknowledge that this assessment is not a diagnosis.",
      });
    }

    // Duplicate submission protection via session token
    let session: InstanceType<typeof AssessmentSession> | null = null;
    if (req.body?.sessionId && req.body?.submissionToken) {
      session = await AssessmentSession.findOne({
        sessionId: String(req.body.sessionId),
        assessmentSlug: def.slug,
      });
      if (!session || session.submissionToken !== String(req.body.submissionToken)) {
        return res.status(400).json({ message: "Invalid assessment session" });
      }
      if (session.status === "completed" && session.completedResultId) {
        if (req.user) {
          const existing = await AssessmentResult.findOne({
            resultId: session.completedResultId,
            userId: req.user._id,
          }).lean();
          if (existing) {
            return res.json({
              duplicate: true,
              resultId: existing.resultId,
              saved: existing.saved,
              scoring: existing.scoring,
              summary: existing.summary,
              completedAt: existing.completedAt,
              recommendations: recommendationPayload(def, existing.scoring as any),
              primaryNextStep: def.primaryNextStep,
              crisis: getCrisisSupportPayload(),
              title: existing.title,
              assessmentSlug: existing.assessmentSlug,
              instrumentVersion: existing.instrumentVersion,
              license: {
                source: def.license.source,
                clinicallyValidated: def.license.clinicallyValidated,
                notes: def.license.notes,
              },
            });
          }
        }
        return res.status(409).json({ message: "Assessment already submitted" });
      }
    }

    const scoring = scoreAssessment(def, answers);
    const saveResults = Boolean(req.body?.saveResults) && Boolean(req.user);
    const resultId = newId("aresult");
    const completedAt = new Date();
    const summary = scoring.interpretationSummary;

    if (saveResults && req.user) {
      await AssessmentResult.create({
        resultId,
        userId: req.user._id,
        assessmentId: def.id,
        assessmentSlug: def.slug,
        instrumentVersion: def.version,
        title: def.title,
        answers,
        scoring,
        summary,
        saved: true,
        completedAt,
      });
    }

    if (session) {
      session.status = "completed";
      session.answers = answers as any;
      session.completedResultId = saveResults ? resultId : undefined;
      await session.save();
    }

    res.status(201).json({
      resultId: saveResults ? resultId : null,
      saved: saveResults,
      title: def.title,
      assessmentSlug: def.slug,
      instrumentVersion: def.version,
      completedAt,
      scoring,
      summary,
      recommendations: recommendationPayload(def, scoring),
      primaryNextStep: def.primaryNextStep,
      crisis: getCrisisSupportPayload(),
      license: {
        source: def.license.source,
        clinicallyValidated: def.license.clinicallyValidated,
        notes: def.license.notes,
      },
      guestNote: !req.user
        ? "Sign in to save this result to your assessment history."
        : !saveResults
          ? "Result was not saved to history, as requested."
          : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to submit assessment";
    if (
      message.includes("required") ||
      message.includes("Invalid") ||
      message.includes("Unknown") ||
      message.includes("expects")
    ) {
      return res.status(400).json({ message });
    }
    logger.error("[ASSESSMENT] Submit error", { error: String(error) });
    res.status(500).json({ message: "Failed to submit assessment" });
  }
});

export default router;
