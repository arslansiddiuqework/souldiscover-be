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
import twilioRouter   from "./routes/twilio";
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
app.use(helmet()); // Security headers
app.use(cors({
  origin: true, // Reflects the origin, allowing any frontend (including vercel branch previews)
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"]
})); // Enable permissive CORS
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies (Twilio)
app.use(morgan("dev")); // HTTP request logger

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
app.use("/api/twilio", ensureDb, twilioRouter);
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
