/**
 * Admin Consultation Routes
 * Track psychologist booking requests.
 */

import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { Consultation } from "../../models/Consultation";
import { User } from "../../models/User";
import {
  adminAuth,
  requirePermission,
  requireAnyPermission,
} from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

router.get("/", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || "";
    const status = (req.query.status as string) || "";
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {};
    if (status && status !== "all") filter.status = status;

    if (search) {
      const users = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");
      filter.$or = [
        { userId: { $in: users.map((u) => u._id) } },
        { clientName: { $regex: search, $options: "i" } },
        { clientEmail: { $regex: search, $options: "i" } },
        { reason: { $regex: search, $options: "i" } },
        { psychologistName: { $regex: search, $options: "i" } },
      ];
    }

    const [bookings, total, statusCounts] = await Promise.all([
      Consultation.find(filter).sort({ date: -1, updatedAt: -1 }).skip(skip).limit(limit),
      Consultation.countDocuments(filter),
      Consultation.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    ]);

    const userIds = [...new Set(bookings.map((b) => String(b.userId)))];
    const users = await User.find({ _id: { $in: userIds } }).select(
      "name email profileImage"
    );
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const enriched = bookings.map((b) => {
      const user = userMap.get(String(b.userId));
      return {
        _id: b._id,
        bookingId: b.bookingId,
        psychologistId: b.psychologistId,
        psychologistName: b.psychologistName,
        date: b.date,
        time: b.time,
        durationMinutes: b.durationMinutes,
        priceUsd: b.priceUsd,
        status: b.status,
        clientName: b.clientName,
        clientEmail: b.clientEmail,
        reason: b.reason,
        notes: b.notes,
        paymentStatus: b.paymentStatus,
        createdAt: b.createdAt,
        updatedAt: b.updatedAt,
        user: user
          ? {
              _id: user._id,
              name: user.name,
              email: user.email,
              profileImage: user.profileImage,
            }
          : null,
      };
    });

    const counts: Record<string, number> = {
      scheduled: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const row of statusCounts) {
      counts[row._id] = row.count;
    }

    const today = new Date().toISOString().slice(0, 10);
    const upcoming = await Consultation.countDocuments({
      status: "scheduled",
      date: { $gte: today },
    });

    res.json({
      consultations: enriched,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      },
      summary: {
        totalBookings: await Consultation.countDocuments(),
        scheduled: counts.scheduled || 0,
        completed: counts.completed || 0,
        cancelled: counts.cancelled || 0,
        upcoming,
      },
    });
  } catch (error) {
    logger.error("[ADMIN_CONSULTATIONS] List error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch consultations" });
  }
});

router.get("/:id", requirePermission("users.read"), async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }
    const booking = await Consultation.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const user = await User.findById(booking.userId).select(
      "name email profileImage"
    );

    res.json({ consultation: booking, user });
  } catch (error) {
    logger.error("[ADMIN_CONSULTATIONS] Detail error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch consultation detail" });
  }
});

router.patch(
  "/:id/status",
  // consultations.write preferred; users.block kept during permission migration
  requireAnyPermission("consultations.write", "users.block"),
  async (req: Request, res: Response) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid booking ID" });
    }
    const { status } = req.body;
    if (!["scheduled", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const booking = await Consultation.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    logger.info("[ADMIN_CONSULTATIONS] Status updated", {
      bookingId: req.params.id,
      status,
      adminId: String(req.admin!._id),
    });

    const { recordSecurityEvent } = await import("../../services/securityAudit.service");
    recordSecurityEvent({
      category: "ADMIN",
      severity: "INFO",
      action: "consultation_status_updated",
      description: `Consultation status set to ${status}.`,
      actorType: "admin",
      actorId: req.admin!._id,
      email: req.admin!.email,
      req,
      meta: { bookingId: req.params.id, status },
    });

    res.json({ consultation: booking, message: "Status updated" });
  } catch (error) {
    logger.error("[ADMIN_CONSULTATIONS] Status error", { error: String(error) });
    res.status(500).json({ message: "Failed to update consultation status" });
  }
});

export default router;
