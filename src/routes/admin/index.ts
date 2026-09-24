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

const router = Router();

router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/sessions", sessionsRouter);
router.use("/emergency", emergencyRouter);
router.use("/analytics", analyticsRouter);
router.use("/logs", logsRouter);
router.use("/settings", settingsRouter);

export default router;
