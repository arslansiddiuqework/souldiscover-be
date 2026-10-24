import { Request, Response } from "express";
import { ChatSession } from "../models/ChatSession";
import { ChatIdempotency } from "../models/ChatIdempotency";
import { randomUUID, createHash } from "crypto";
import { logger } from "../utils/logger";
import { Types } from "mongoose";
import { buildPrompt } from "../services/contextBuilder.service";
import { routedGenerateStream } from "../services/aiRouter.service";
import {
  shouldUpdateSummary,
  updateSummary,
  generateTitle,
} from "../services/summarizer.service";
import { MessageAnalysis } from "../types";
import { Mood } from "../models/Mood";
import { analyzeUserState } from "../services/emotionAI.service";
import * as escalationEngine from "../services/crisis/escalation-engine.service";
import { fuseEmotion, buildFusionContext } from "../services/emotionFusion.service";
import { FusionInput } from "../services/emotionWeights";
import {
  reserveQuota,
  releaseQuota,
  QuotaReservation,
} from "../services/aiQuota.service";

const MAX_MESSAGE_LENGTH = 2000;
const DUPLICATE_WINDOW_MS = 15_000;

const defaultAnalysis: MessageAnalysis = {
  emotionalState: "neutral",
  themes: [],
  riskLevel: 0,
  recommendedApproach: "supportive",
  progressIndicators: [],
};

function messageDedupeKey(
  userId: string,
  sessionId: string,
  message: string
): string {
  const bucket = Math.floor(Date.now() / DUPLICATE_WINDOW_MS);
  return createHash("sha256")
    .update(`${userId}|${sessionId}|${message.trim()}|${bucket}`)
    .digest("hex");
}

async function claimIdempotency(
  userId: string,
  key: string,
  sessionId: string
): Promise<"claimed" | "duplicate" | "error"> {
  try {
    await ChatIdempotency.create({
      userId,
      key,
      sessionId,
    });
    return "claimed";
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    if (code === 11000) return "duplicate";
    logger.error("Idempotency claim failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return "error";
  }
}

export const createChatSession = async (req: Request, res: Response) => {
  try {
    if (!req.user || !req.user._id) {
      return res
        .status(401)
        .json({ message: "Unauthorized - User not authenticated" });
    }

    const userId = req.user._id;
    const sessionId = randomUUID();

    const session = new ChatSession({
      sessionId,
      userId,
      title: "New Therapy Session",
      startTime: new Date(),
      status: "active",
      messages: [],
    });

    await session.save();

    res.status(201).json({
      message: "Chat session created successfully",
      sessionId: session.sessionId,
    });
  } catch (error) {
    logger.error("Error creating chat session:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  let reservation: QuotaReservation | null = null;
  let streamingStarted = false;

  try {
    const { sessionId } = req.params;
    const { message, source, clientRequestId } = req.body;
    const messageSource = source === "voice" ? "voice" : "text";
    const userId = req.user._id;
    const userName = req.user.name;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ message: "Message is required" });
    }

    const trimmed = message.trim();
    if (!trimmed) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }
    if (trimmed.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        message: `Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`,
      });
    }

    const session = await ChatSession.findOne({ sessionId });
    if (!session) {
      logger.warn("Session not found:", { sessionId });
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      logger.warn("Unauthorized access attempt:", { sessionId, userId: String(userId) });
      return res.status(403).json({ message: "Unauthorized" });
    }

    if (session.status === "completed" || session.status === "archived") {
      logger.warn("Attempted to message a locked session:", {
        sessionId,
        status: session.status,
      });
      return res
        .status(400)
        .json({ message: "This session has been completed and is locked." });
    }

    const idemKey =
      typeof clientRequestId === "string" && clientRequestId.trim().length >= 8
        ? `client:${clientRequestId.trim().slice(0, 128)}`
        : `auto:${messageDedupeKey(userId.toString(), sessionId, trimmed)}`;

    const claim = await claimIdempotency(userId.toString(), idemKey, sessionId);
    if (claim === "duplicate") {
      return res.status(409).json({
        message:
          "That message was already received. Please wait for the reply or try a new message.",
        code: "duplicate_submission",
      });
    }
    if (claim === "error") {
      return res.status(503).json({
        message:
          "We're having trouble processing chat right now. Please try again shortly.",
      });
    }

    // Reserve quota BEFORE contacting OpenRouter
    const quota = await reserveQuota(userId.toString());
    if (!quota.ok) {
      return res.status(429).json({
        message: quota.message,
        code: `quota_${quota.reason}`,
      });
    }
    reservation = quota.reservation;

    // Streaming headers only after auth/quota/validation succeed
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    streamingStarted = true;

    logger.info("Processing chat message", {
      sessionId,
      source: messageSource,
    });

    const allMessages = session.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const summary = session.summary || "";

    const latestMoodDoc = await Mood.findOne({ userId }).sort({ timestamp: -1 });
    let latestMood: "low" | "neutral" | "positive" | "unknown" = "unknown";
    if (latestMoodDoc) {
      if (latestMoodDoc.score <= 40) latestMood = "low";
      else if (latestMoodDoc.score >= 70) latestMood = "positive";
      else latestMood = "neutral";
    }

    const aiName =
      !req.user.aiName || req.user.aiName === "Maya"
        ? "Soul Discovery"
        : req.user.aiName;
    const aiBehavior = req.user.aiBehavior || "supportive";

    const recentContext = allMessages
      .slice(-3)
      .map((m) => m.content)
      .join(" | ");
    const emotionMeta = await analyzeUserState({
      userMessage: trimmed,
      recentMessages: recentContext,
      sessionSummary: summary,
      latestMood,
    }).catch((err) => {
      logger.warn("Emotion analysis failed in background", err);
      return null;
    });

    let fusionContextStr: string | undefined;
    try {
      const recentMoods = await Mood.find({ userId })
        .sort({ timestamp: -1 })
        .limit(5)
        .lean();

      let historyScore: number | undefined;
      if (recentMoods.length > 0) {
        historyScore = Math.round(
          recentMoods.reduce((sum, m) => sum + m.score, 0) / recentMoods.length
        );
      }

      const fusionInput: FusionInput = {
        textEmotion: emotionMeta?.emotion,
        faceScore:
          latestMoodDoc?.source === "camera" ? latestMoodDoc.score : undefined,
        faceMood:
          latestMoodDoc?.source === "camera"
            ? (latestMoodDoc.mood ?? undefined)
            : undefined,
        historyScore,
      };

      const fusionResult = fuseEmotion(fusionInput);
      fusionContextStr = buildFusionContext(fusionResult, fusionInput);

      logger.info("Emotion Fusion", {
        score: fusionResult.score,
        mood: fusionResult.mood,
        confidence: fusionResult.confidence,
        mismatch: fusionResult.mismatch,
        sources: fusionResult.sources,
      });
    } catch (err) {
      logger.warn("Emotion fusion failed, continuing without", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Chat stays conversation-only — never inject activity / mini-game prompts.
    const prompt = buildPrompt(
      trimmed,
      allMessages,
      summary,
      userName,
      latestMood,
      aiName,
      aiBehavior,
      null,
      fusionContextStr
    );

    const abortController = new AbortController();
    req.on("close", () => {
      if (!res.writableEnded) {
        logger.info("Client disconnected, aborting AI stream", { sessionId });
        abortController.abort();
      }
    });

    const {
      fullText,
      modelUsed,
      fallbackUsed,
      error: llmError,
      errorCode,
    } = await routedGenerateStream(
      prompt,
      (chunk) => {
        if (!res.writableEnded) {
          res.write(JSON.stringify({ t: "chunk", d: chunk }) + "\n");
        }
      },
      {
        primaryMaxTokens: 250,
        temperature: 0.7,
      },
      abortController.signal
    );

    // Provider failed without a usable reply — release reservation
    if (llmError) {
      await releaseQuota(reservation);
      reservation = null;
    }

    const reply = fullText.trim();

    logger.info("Generated response", {
      sessionId,
      modelUsed,
      fallbackUsed,
      replyLength: reply.length,
      error: Boolean(llmError),
      errorCode,
    });

    if (emotionMeta && !llmError) {
      void escalationEngine.evaluate(
        userId.toString(),
        sessionId,
        userName || "User",
        emotionMeta,
        trimmed
      );
    }

    // Persist only when we have a non-error reply (or soft error message already streamed)
    const updatedSession = await ChatSession.findOneAndUpdate(
      { sessionId, userId },
      {
        $push: {
          messages: {
            $each: [
              {
                role: "user",
                content: trimmed,
                timestamp: new Date(),
                metadata: {
                  emotionMeta: emotionMeta
                    ? { ...emotionMeta, suggestedActivity: null, musicRecommendation: null }
                    : emotionMeta,
                  source: messageSource,
                },
              },
              {
                role: "assistant",
                content: reply,
                timestamp: new Date(),
                metadata: {
                  analysis: defaultAnalysis,
                  technique: defaultAnalysis.recommendedApproach,
                  goal: "Provide support",
                  progress: {
                    emotionalState: defaultAnalysis.emotionalState,
                    riskLevel: defaultAnalysis.riskLevel,
                  },
                  emotionMeta: emotionMeta
                    ? { ...emotionMeta, suggestedActivity: null, musicRecommendation: null }
                    : emotionMeta,
                  source: messageSource,
                },
              },
            ],
          },
        },
      },
      { new: true }
    );

    if (updatedSession && !llmError) {
      logger.info("Session updated atomically", {
        sessionId,
        messageCount: updatedSession.messages.length,
      });

      const isDefaultTitle =
        updatedSession.title === "New Session" ||
        updatedSession.title === "New Therapy Session";

      if (updatedSession.messages.length >= 2 && isDefaultTitle) {
        generateTitle(trimmed, reply)
          .then((title) => {
            if (title && title.length > 2) {
              ChatSession.updateOne({ sessionId }, { $set: { title } }).catch(
                (err) => logger.error("Title update error", err)
              );
            }
          })
          .catch((err) => logger.error("Title generation error", err));
      }

      const msgCount = updatedSession.messages.length;
      const hasSummary = !!updatedSession.summary;

      if (shouldUpdateSummary(msgCount, hasSummary)) {
        const msgs = updatedSession.messages.map((m) => ({
          role: m.role,
          content: m.content,
        }));
        updateSummary(sessionId, msgs, updatedSession.summary || "").catch(
          (err) =>
            logger.warn("Background summary update failed", {
              error: String(err),
            })
        );
      }
    }

    if (!res.writableEnded) {
      res.write(
        JSON.stringify({
          t: "done",
          analysis: defaultAnalysis,
          modelUsed,
          fallbackUsed,
          error: llmError,
          errorCode,
          metadata: {
            progress: {
              emotionalState: defaultAnalysis.emotionalState,
              riskLevel: defaultAnalysis.riskLevel,
            },
            emotionMeta: emotionMeta
              ? { ...emotionMeta, suggestedActivity: null, musicRecommendation: null }
              : emotionMeta,
          },
        }) + "\n"
      );
      res.end();
    }
    logger.info("Response stream completed", { sessionId });
  } catch (error) {
    logger.error("Error in sendMessage:", {
      error: error instanceof Error ? error.message : String(error),
    });

    if (reservation) {
      await releaseQuota(reservation);
      reservation = null;
    }

    if (!streamingStarted && !res.headersSent) {
      res.status(500).json({ message: "Internal server error" });
      return;
    }

    if (!res.writableEnded) {
      try {
        res.write(
          JSON.stringify({
            t: "done",
            error: true,
            errorCode: "provider_error",
            message:
              "Something went wrong while generating a reply. Please try again.",
          }) + "\n"
        );
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
};

export const getChatSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    logger.info(`Getting chat session: ${sessionId}`);
    const chatSession = await ChatSession.findOne({
      sessionId,
      userId,
      status: { $ne: "archived" },
    });

    if (!chatSession) {
      logger.warn(`Chat session not found: ${sessionId}`);
      return res.status(404).json({ error: "Chat session not found" });
    }
    logger.info(`Found chat session: ${sessionId}`);
    res.json(chatSession);
  } catch (error) {
    logger.error("Failed to get chat session:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;
    logger.info(`Fetching chat history`, {
      sessionId,
      userId: userId.toString(),
    });

    let session = await ChatSession.findOne({ sessionId });

    if (!session && Types.ObjectId.isValid(sessionId)) {
      session = await ChatSession.findById(sessionId);
    }

    if (!session || session.status === "archived") {
      logger.warn(`Session not found in DB or is archived`, { sessionId });
      return res.status(404).json({ message: "Session not found" });
    }

    if (session.userId.toString() !== userId.toString()) {
      logger.warn(`Ownership mismatch`, {
        sessionId,
        ownerId: session.userId.toString(),
        requestUserId: userId.toString(),
      });
      return res.status(403).json({ message: "Unauthorized" });
    }

    logger.info(`Returning ${session.messages.length} messages to client`);
    res.json(session.messages);
  } catch (error) {
    logger.error("Error fetching chat history:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const getUserSessions = async (req: Request, res: Response) => {
  try {
    const userId = req.user._id;
    const sessions = await ChatSession.find({
      userId,
      status: { $ne: "archived" },
      "messages.0": { $exists: true },
    })
      .select("sessionId title startTime status messages")
      .sort({ startTime: -1 });

    const sessionsWithPreview = sessions.map((session) => {
      const lastMessage =
        session.messages.length > 0
          ? session.messages[session.messages.length - 1]
          : null;
      return {
        sessionId: session.sessionId,
        title: session.title,
        startTime: session.startTime,
        status: session.status,
        lastMessage: lastMessage
          ? {
              content: lastMessage.content,
              timestamp: lastMessage.timestamp,
            }
          : null,
        messageCount: session.messages.length,
      };
    });
    res.json(sessionsWithPreview);
  } catch (error) {
    logger.error("Error fetching user sessions:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const deleteChatSession = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const userId = req.user._id;

    logger.info(`Attempting to delete chat session: ${sessionId}`);

    const deletedSession = await ChatSession.findOneAndDelete({
      sessionId,
      userId,
    });

    if (!deletedSession) {
      logger.warn(
        `Chat session not found or unauthorized for deletion: ${sessionId}`
      );
      return res
        .status(404)
        .json({ message: "Chat session not found or unauthorized" });
    }

    logger.info(`Successfully deleted chat session: ${sessionId}`);
    res.json({ message: "Chat session deleted successfully" });
  } catch (error) {
    logger.error("Failed to delete chat session:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
