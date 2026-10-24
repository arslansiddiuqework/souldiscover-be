import dotenv from "dotenv";
// Load environment variables FIRST before any other imports
dotenv.config();

import "./types";
import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import { errorHandler } from "./middleware/errorHandler";
import { logger } from "./utils/logger";
import authRouter     from "./routes/auth";
import chatRouter     from "./routes/chat";
import moodRouter     from "./routes/mood";
import activityRouter from "./routes/activity";
import userRouter     from "./routes/user";
import emergencyRouter from "./routes/emergency";
import adminRouter    from "./routes/admin";
import progressRouter from "./routes/progress";
import musicRouter    from "./routes/music";
import wellnessRouter from "./routes/wellness-plan";
import consultationRouter from "./routes/consultation";
import assessmentRouter from "./routes/assessments";
import { connectDB, isDbConnected } from "./utils/db";
import { ensureDb } from "./middleware/ensureDb";

// Create Express app
const app: any = express();

const isVercel = Boolean(process.env.VERCEL);

// Middleware
app.use(
  helmet({
    contentSecurityPolicy: false, // JSON API — CSP is enforced on frontends
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

const allowedOrigins = [
  process.env.FRONTEND_URL,
  process.env.ADMIN_FRONTEND_URL,
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "https://www.souldiscovery.online",
  "https://souldiscovery.online",
]
  .filter(Boolean)
  .map((o) => String(o).replace(/\/+$/, ""));

const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter(Boolean);

const corsAllowlist = new Set([...allowedOrigins, ...extraOrigins]);

app.use(
  cors({
    origin(origin, callback) {
      // Non-browser / same-origin / health checks send no Origin
      if (!origin) return callback(null, true);
      if (corsAllowlist.has(origin.replace(/\/+$/, ""))) {
        return callback(null, true);
      }
      // Allow Vercel preview hosts of this project only when explicitly enabled
      if (
        process.env.CORS_ALLOW_VERCEL_PREVIEWS === "true" &&
        /\.vercel\.app$/i.test(new URL(origin).hostname)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Accept",
      "Origin",
      "X-Requested-With",
    ],
  })
);
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));
app.use(morgan(isVercel || process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Routes
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    message: "Server is running",
    db: isDbConnected() ? "connected" : "disconnected",
    vercel: isVercel,
  });
});

// DB-backed route groups — ensure connection on serverless cold starts
app.use("/api/auth", ensureDb, authRouter);
app.use("/api/chat", ensureDb, chatRouter);
app.use("/api/mood", ensureDb, moodRouter);
app.use("/api/activity", ensureDb, activityRouter);
app.use("/api/user", ensureDb, userRouter);
app.use("/api/emergency", ensureDb, emergencyRouter);
app.use("/api/admin", ensureDb, adminRouter);
app.use("/api/progress", ensureDb, progressRouter);
app.use("/api/music", ensureDb, musicRouter);
app.use("/api/wellness-plan", ensureDb, wellnessRouter);
app.use("/api/consultations", ensureDb, consultationRouter);
// Catalog endpoints are mostly in-memory; still attach DB for history/results
app.use("/api/assessments", ensureDb, assessmentRouter);

// Backward compatibility
app.use("/auth", ensureDb, authRouter);
app.use("/chat", ensureDb, chatRouter);
app.use("/mood", ensureDb, moodRouter);
app.use("/activity", ensureDb, activityRouter);
app.use("/user", ensureDb, userRouter);
app.use("/music", ensureDb, musicRouter);
app.use("/wellness-plan", ensureDb, wellnessRouter);
app.use("/consultations", ensureDb, consultationRouter);
app.use("/assessments", ensureDb, assessmentRouter);

// Error handling middleware
app.use(errorHandler);

// Local / traditional hosting only — never call listen() on Vercel serverless
const startServer = async () => {
  try {
    await connectDB();
    const PORT = process.env.PORT || 3001;
    app.listen(PORT, () => {
      logger.info(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
};

if (!isVercel) {
  startServer();
} else {
  // Warm the DB connection on cold start without crashing the function
  void connectDB().catch((error) => {
    logger.error("Vercel cold-start DB connect failed (will retry per request):", error);
  });
}

module.exports = app;
export default app;
