/**
 * Admin Sessions Routes
 * ─────────────────────
 * Read-only access to all therapy sessions across all users.
 * Admin can view transcripts and flag sessions, but CANNOT edit messages.
 *
 * GET  /api/admin/sessions          — List all sessions (paginated)
 * GET  /api/admin/sessions/:id      — Get single session with transcript
 * POST /api/admin/sessions/:id/flag — Toggle flag on a session
 */

import { Router, Request, Response } from "express";
import { ChatSession } from "../../models/ChatSession";
import { User } from "../../models/User";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

// ── GET / — List all sessions ─────────────────────────────────────────────────
router.get("/", requirePermission("sessions.read"), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = {};
    if (status && ["active", "completed", "archived"].includes(status)) {
      filter.status = status;
    }
    // Only return sessions that have at least one message
    filter["messages.0"] = { $exists: true };

    const { userId } = req.query;
    if (userId) {
      filter.userId = userId;
    }

    if (search) {
      // Find matching users by name or email
      const matchingUsers = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ]
      }).select("_id");
      const userIds = matchingUsers.map((u) => u._id);
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { userId: { $in: userIds } },
      ];
    }

    const [sessions, total] = await Promise.all([
      ChatSession.find(filter)
        .select("sessionId userId title startTime status messages")
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit),
      ChatSession.countDocuments(filter),
    ]);

    // Enrich with user names and compute metadata
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        const user = await User.findById(session.userId).select("name email profileImage");

        // Calculate duration from first to last message
        let duration = "N/A";
        if (session.messages.length >= 2) {
          const first = session.messages[0].timestamp;
          const last = session.messages[session.messages.length - 1].timestamp;
          const diffMs = new Date(last).getTime() - new Date(first).getTime();
          const mins = Math.floor(diffMs / 60000);
          const secs = Math.floor((diffMs % 60000) / 1000);
          duration = `${mins}m ${secs}s`;
        }

        // Check if any message has high risk
        let hasRisk = false;
        for (const msg of session.messages) {
          const riskLevel = msg.metadata?.progress?.riskLevel;
          const crisisScore = msg.metadata?.emotionMeta?.crisisRiskScore;
          if ((riskLevel && riskLevel > 0.5) || (crisisScore && crisisScore > 0.5)) {
            hasRisk = true;
            break;
          }
        }

        return {
          _id: session._id,
          sessionId: session.sessionId,
          userId: session.userId,
          userName: user?.name || "Unknown User",
          userEmail: user?.email || "",
          userProfileImage: user?.profileImage || "",
          title: session.title,
          startTime: session.startTime,
          status: session.status,
          messageCount: session.messages.length,
          duration,
          hasRisk,
        };
      })
    );

    res.json({
      sessions: enrichedSessions,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("[ADMIN_SESSIONS] List sessions error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch sessions" });
  }
});

// ── GET /:id — Single session with transcript ─────────────────────────────────
router.get("/:id", requirePermission("sessions.read"), async (req: Request, res: Response) => {
  try {
    const session = await ChatSession.findOne({ sessionId: req.params.id });
    if (!session) return res.status(404).json({ message: "Session not found" });

    const user = await User.findById(session.userId).select("name email profileImage");

    // Check if any message has high risk
    let hasRisk = false;
    for (const msg of session.messages) {
      const riskLevel = msg.metadata?.progress?.riskLevel;
      const crisisScore = msg.metadata?.emotionMeta?.crisisRiskScore;
      if ((riskLevel && riskLevel > 0.5) || (crisisScore && crisisScore > 0.5)) {
        hasRisk = true;
        break;
      }
    }

    // Only return messages if the session is flagged as High Risk
    const messages = hasRisk
      ? session.messages.map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          metadata: m.metadata,
        }))
      : [];

    res.json({
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
        title: session.title,
        summary: session.summary,
        startTime: session.startTime,
        status: session.status,
        messageCount: session.messages.length,
        hasRisk,
      },
      user: user ? { name: user.name, email: user.email, profileImage: user.profileImage } : null,
      messages,
    });
  } catch (error) {
    logger.error("[ADMIN_SESSIONS] Get session error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch session" });
  }
});

// ── PATCH /:id/status — Update session status ─────────────────────────────────
router.patch("/:id/status", requirePermission("sessions.write"), async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!status || !["active", "completed", "archived"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const session = await ChatSession.findOneAndUpdate(
      { sessionId: req.params.id },
      { status },
      { new: true }
    );

    if (!session) return res.status(404).json({ message: "Session not found" });

    logger.info(`[ADMIN_SESSIONS] Session ${session.sessionId} status updated to ${status} by admin`);
    res.json({ message: "Session status updated successfully", session });
  } catch (error) {
    logger.error("[ADMIN_SESSIONS] Update session status error", { error: String(error) });
    res.status(500).json({ message: "Failed to update session status" });
  }
});

export default router;
