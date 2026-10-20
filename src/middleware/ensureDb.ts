import { Request, Response, NextFunction } from "express";
import { connectDB } from "../utils/db";
import { logger } from "../utils/logger";

/**
 * Ensures MongoDB is connected before DB-backed routes run.
 * Critical on Vercel where app.listen() is not used and cold starts
 * must connect lazily per invocation.
 */
export async function ensureDb(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    await connectDB();
    next();
  } catch (error) {
    logger.error("ensureDb failed:", error);
    res.status(503).json({
      message:
        "Database unavailable. Check MONGODB_URI and Atlas Network Access (allow Vercel IPs / 0.0.0.0/0).",
    });
  }
}
