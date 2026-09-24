/**
 * Admin Users Routes
 * ──────────────────
 * Read-only + moderation access to the User collection.
 * NEVER modifies user auth flow, therapy workflow, or AI pipeline.
 *
 * GET    /api/admin/users           — List all users (paginated, searchable)
 * GET    /api/admin/users/:id       — Get single user detail
 * PATCH  /api/admin/users/:id/block — Block a user
 * PATCH  /api/admin/users/:id/unblock — Unblock a user
 * DELETE /api/admin/users/:id       — Delete a user
 */

import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { User } from "../../models/User";
import { ChatSession } from "../../models/ChatSession";
import { EmergencyContact } from "../../models/EmergencyContact";
import { EscalationLog } from "../../models/EscalationLog";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

// ── GET / — List users ────────────────────────────────────────────────────────
router.get("/", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";
    const skip = (page - 1) * limit;

    // Build filter
    const filter: Record<string, any> = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }
    
    if (status && status !== "all") {
      filter.status = status;
    }

    const [users, total] = await Promise.all([
      User.find(filter).select("-password").sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    // Enrich each user with session count and emergency flag
    const enrichedUsers = await Promise.all(
      users.map(async (user) => {
        const [sessionCount, emergencyRecord, lastEscalation] = await Promise.all([
          ChatSession.countDocuments({ userId: user._id }),
          EmergencyContact.findOne({ userId: user._id }),
          EscalationLog.findOne({ userId: user._id }).sort({ createdAt: -1 }),
        ]);

        return {
          _id: user._id,
          name: user.name,
          email: user.email,
          profileImage: user.profileImage,
          aiName: user.aiName,
          aiBehavior: user.aiBehavior,
          status: user.status || "active",
          createdAt: (user as any).createdAt,
          updatedAt: (user as any).updatedAt,
          sessionCount,
          hasEmergencyContacts: (emergencyRecord?.contacts?.length || 0) > 0,
          emergencyContactCount: emergencyRecord?.contacts?.length || 0,
          consentAccepted: emergencyRecord?.consentAccepted || false,
          lastEscalation: lastEscalation
            ? {
                riskLevel: lastEscalation.riskLevel,
                outcome: lastEscalation.outcome,
                createdAt: lastEscalation.createdAt,
              }
            : null,
        };
      })
    );

    res.json({
      users: enrichedUsers,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("[ADMIN_USERS] List users error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// ── GET /:id — Single user detail ─────────────────────────────────────────────
router.get("/:id", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    const user = await User.findById(req.params.id).select("-password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const [sessions, emergencyRecord, escalationLogs] = await Promise.all([
      ChatSession.find({ userId: user._id })
        .select("sessionId title startTime status messages")
        .sort({ startTime: -1 })
        .limit(20),
      EmergencyContact.findOne({ userId: user._id }),
      EscalationLog.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10),
    ]);

    const sessionsWithCounts = sessions.map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      startTime: s.startTime,
      status: s.status,
      messageCount: s.messages.length,
    }));

    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage,
        aiName: user.aiName,
        aiBehavior: user.aiBehavior,
        status: user.status || "active",
        createdAt: (user as any).createdAt,
      },
      sessions: sessionsWithCounts,
      emergencyContacts: emergencyRecord?.contacts || [],
      consentAccepted: emergencyRecord?.consentAccepted || false,
      escalationSettings: emergencyRecord?.escalationSettings || null,
      escalationLogs,
    });
  } catch (error) {
    logger.error("[ADMIN_USERS] Get user detail error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch user details" });
  }
});

// ── PATCH /:id/status — Change user status ────────────────────────────────────
router.patch("/:id/status", requirePermission("users.block"), async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    const { status } = req.body;
    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be active or suspended." });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    logger.info("[ADMIN_USERS] User status updated", {
      userId: req.params.id,
      status,
      adminId: String(req.admin!._id),
    });

    res.json({ message: "User status updated successfully", user });
  } catch (error) {
    logger.error("[ADMIN_USERS] Update user status error", { error: String(error) });
    res.status(500).json({ message: "Failed to update user status" });
  }
});

// ── DELETE /:id — Delete user ─────────────────────────────────────────────────
router.delete("/:id", requirePermission("users.delete"), async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Clean up related data
    await Promise.all([
      ChatSession.deleteMany({ userId: user._id }),
      EmergencyContact.deleteMany({ userId: user._id }),
      EscalationLog.deleteMany({ userId: user._id }),
    ]);

    logger.info("[ADMIN_USERS] User deleted", { userId: req.params.id, adminId: String(req.admin!._id) });
    res.json({ message: "User and associated data deleted successfully" });
  } catch (error) {
    logger.error("[ADMIN_USERS] Delete user error", { error: String(error) });
    res.status(500).json({ message: "Failed to delete user" });
  }
});

export default router;
