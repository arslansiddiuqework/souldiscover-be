/**
 * Admin Auth Routes
 * ─────────────────
 * POST /api/admin/auth/login    — Admin login (separate from user login)
 * POST /api/admin/auth/logout   — Admin logout
 * GET  /api/admin/auth/me       — Get current admin profile
 * PUT  /api/admin/auth/profile  — Update admin name/email
 * POST /api/admin/auth/forgot-password — Admin forgot password
 * POST /api/admin/auth/reset-password  — Admin reset password
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import { Admin } from "../../models/Admin";
import { adminAuth } from "../../middleware/adminAuth";
import { sendPasswordResetEmail } from "../../services/email.service";
import { deleteImage, uploadImage } from "../../services/cloudinary.service";
import { logger } from "../../utils/logger";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// ── POST /login ───────────────────────────────────────────────────────────────
router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!admin.isActive) {
      return res.status(403).json({ message: "Admin account is deactivated." });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    // Generate admin-specific JWT (uses adminId, NOT userId)
    const token = jwt.sign(
      { adminId: admin._id, role: admin.role },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    logger.info("[ADMIN_AUTH] Admin login successful", { adminId: String(admin._id) });

    res.json({
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        profileImage: admin.profileImage,
        role: admin.role,
        permissions: admin.permissions,
        lastLogin: admin.lastLogin,
      },
      token,
      message: "Admin login successful",
    });
  } catch (error) {
    logger.error("[ADMIN_AUTH] Login error", { error: String(error) });
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /logout ──────────────────────────────────────────────────────────────
router.post("/logout", adminAuth, (_req: Request, res: Response) => {
  res.json({ message: "Admin logged out successfully" });
});

// ── GET /me ───────────────────────────────────────────────────────────────────
router.get("/me", adminAuth, async (req: Request, res: Response) => {
  try {
    const admin = await Admin.findById(req.admin!._id).select("-password");
    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    res.json({
      authenticated: true,
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        profileImage: admin.profileImage,
        role: admin.role,
        permissions: admin.permissions,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── PUT /profile ──────────────────────────────────────────────────────────────
router.put("/profile", adminAuth, async (req: Request, res: Response) => {
  try {
    const { name, email, profileImage } = req.body;
    const updateData: Record<string, string> = {};
    if (name) updateData.name = name.trim();
    if (email) updateData.email = email.trim().toLowerCase();
    if (profileImage !== undefined) updateData.profileImage = profileImage;

    const admin = await Admin.findByIdAndUpdate(
      req.admin!._id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select("-password");

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    res.json({
      message: "Profile updated successfully",
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        profileImage: admin.profileImage,
        role: admin.role,
        permissions: admin.permissions,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /forgot-password ─────────────────────────────────────────────────────
router.post("/forgot-password", async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) {
      return res.status(200).json({ message: "If an admin account exists, a reset link has been sent." });
    }

    const resetToken = jwt.sign(
      { adminId: admin._id },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "15m" }
    );

    const frontendUrl = process.env.ADMIN_FRONTEND_URL || "http://localhost:3001";
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    await sendPasswordResetEmail(admin.email, resetLink);

    res.status(200).json({ message: "If an admin account exists, a reset link has been sent." });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /reset-password ──────────────────────────────────────────────────────
router.post("/reset-password", async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: "Token and new password are required." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key") as { adminId: string };
    } catch {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    const admin = await Admin.findById(decoded.adminId);
    if (!admin) {
      return res.status(404).json({ message: "Admin not found." });
    }

    admin.password = await bcrypt.hash(password, 10);
    await admin.save();

    res.status(200).json({ message: "Password has been successfully reset." });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /upload-avatar ────────────────────────────────────────────────────────
router.post("/upload-avatar", adminAuth, upload.single("image") as any, async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }
    logger.info("[ADMIN_AUTH] Uploading admin avatar to Cloudinary...");
    const imageUrl = await uploadImage(req.file.buffer);
    res.status(200).json({
      message: "Image uploaded successfully",
      imageUrl,
    });
  } catch (error: any) {
    logger.error("[ADMIN_AUTH] Upload avatar error", { error: String(error) });
    res.status(500).json({ message: "Failed to upload image", error: error.message });
  }
});

// DELETE /delete-avatar 
router.delete("/delete-avatar", adminAuth, async (req: Request, res: Response) => {
  try {
    const currentAdmin = await Admin.findById(req.admin!._id).select("profileImage");

    if (!currentAdmin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    const existingImageUrl = currentAdmin.profileImage;
    const admin = await Admin.findByIdAndUpdate(
      req.admin!._id,
      { $set: { profileImage: "" } },
      { new: true, runValidators: true }
    ).select("-password");

    if (!admin) {
      return res.status(404).json({ message: "Admin not found" });
    }

    await deleteImage(existingImageUrl);

    res.status(200).json({
      message: "Profile image deleted successfully",
      admin: {
        _id: admin._id,
        name: admin.name,
        email: admin.email,
        profileImage: admin.profileImage,
        role: admin.role,
        permissions: admin.permissions,
        lastLogin: admin.lastLogin,
      },
    });
  } catch (error: any) {
    logger.error("[ADMIN_AUTH] Delete avatar error", { error: String(error) });
    res.status(500).json({ message: "Failed to delete image", error: error.message });
  }
});

export default router;
