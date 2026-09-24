import express from "express";
import { getWeeklyProgress } from "../controllers/progressController";
import { auth } from "../middleware/auth";

const router = express.Router();

router.get("/weekly", auth, getWeeklyProgress);

export default router;
