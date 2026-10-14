/**
 * User Consultation Booking Routes
 * Persists psychologist bookings so admin can track them.
 */

import { Router, Request, Response } from "express";
import { auth } from "../middleware/auth";
import { Consultation } from "../models/Consultation";
import { logger } from "../utils/logger";

const router = Router();
router.use(auth);

function toClient(doc: InstanceType<typeof Consultation>) {
  return {
    id: doc.bookingId,
    psychologistId: doc.psychologistId,
    psychologistName: doc.psychologistName,
    date: doc.date,
    time: doc.time,
    durationMinutes: doc.durationMinutes,
    priceUsd: doc.priceUsd,
    status: doc.status,
    clientName: doc.clientName,
    clientEmail: doc.clientEmail,
    reason: doc.reason,
    notes: doc.notes,
    createdAt: doc.createdAt?.toISOString?.() || String(doc.createdAt),
    updatedAt: doc.updatedAt?.toISOString?.() || String(doc.updatedAt),
    paymentStatus: doc.paymentStatus,
  };
}

// GET /
router.get("/", async (req: Request, res: Response) => {
  try {
    const bookings = await Consultation.find({ userId: req.user!._id }).sort({
      date: -1,
      updatedAt: -1,
    });
    res.json({ consultations: bookings.map(toClient) });
  } catch (error) {
    logger.error("[CONSULTATION] List error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch consultations" });
  }
});

// PUT / — upsert booking
router.put("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body?.id || !body?.date || !body?.time || !body?.clientName || !body?.clientEmail) {
      return res.status(400).json({
        message: "id, date, time, clientName, and clientEmail are required",
      });
    }

    const booking = await Consultation.findOneAndUpdate(
      { userId: req.user!._id, bookingId: body.id },
      {
        bookingId: body.id,
        userId: req.user!._id,
        psychologistId: body.psychologistId || "psych_dr_elena",
        psychologistName: body.psychologistName || "Dr. Faya Arslan",
        date: body.date,
        time: body.time,
        durationMinutes: body.durationMinutes || 90,
        priceUsd: body.priceUsd ?? 10,
        status: body.status || "scheduled",
        clientName: body.clientName,
        clientEmail: body.clientEmail,
        reason: body.reason || "",
        notes: body.notes,
        paymentStatus: body.paymentStatus || "placeholder",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ consultation: toClient(booking!), message: "Consultation synced" });
  } catch (error) {
    logger.error("[CONSULTATION] Upsert error", { error: String(error) });
    res.status(500).json({ message: "Failed to sync consultation" });
  }
});

// PATCH /:bookingId/status
router.patch("/:bookingId/status", async (req: Request, res: Response) => {
  try {
    const { status } = req.body;
    if (!["scheduled", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const booking = await Consultation.findOneAndUpdate(
      { userId: req.user!._id, bookingId: req.params.bookingId },
      { status },
      { new: true }
    );
    if (!booking) return res.status(404).json({ message: "Booking not found" });
    res.json({ consultation: toClient(booking) });
  } catch (error) {
    logger.error("[CONSULTATION] Status error", { error: String(error) });
    res.status(500).json({ message: "Failed to update consultation status" });
  }
});

// DELETE /:bookingId
router.delete("/:bookingId", async (req: Request, res: Response) => {
  try {
    const deleted = await Consultation.findOneAndDelete({
      userId: req.user!._id,
      bookingId: req.params.bookingId,
    });
    if (!deleted) return res.status(404).json({ message: "Booking not found" });
    res.json({ message: "Consultation deleted" });
  } catch (error) {
    logger.error("[CONSULTATION] Delete error", { error: String(error) });
    res.status(500).json({ message: "Failed to delete consultation" });
  }
});

export default router;
