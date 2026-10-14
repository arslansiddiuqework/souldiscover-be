/**
 * Admin Routes — Barrel
 * ─────────────────────
 * Mounts all admin sub-routes under /api/admin.
 * Completely isolated from user routes.
 */

import { Router } from "express";
import authRouter from "./auth";
import usersRouter from "./users";
import sessionsRouter from "./sessions";
import emergencyRouter from "./emergency";
import analyticsRouter from "./analytics";
import logsRouter from "./logs";
import settingsRouter from "./settings";
import wellnessRouter from "./wellness";
import consultationsRouter from "./consultations";
import assessmentsRouter from "./assessments";

const router = Router();

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/sessions", sessionsRouter);
router.use("/emergency", emergencyRouter);
router.use("/analytics", analyticsRouter);
router.use("/logs", logsRouter);
router.use("/settings", settingsRouter);
router.use("/wellness", wellnessRouter);
router.use("/consultations", consultationsRouter);
router.use("/assessments", assessmentsRouter);

export default router;
