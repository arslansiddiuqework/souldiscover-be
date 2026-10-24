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
import crypto from "crypto";
import bcrypt from "bcryptjs";
import multer from "multer";
import { Admin } from "../../models/Admin";
import { adminAuth } from "../../middleware/adminAuth";
import { sendPasswordResetEmail } from "../../services/email.service";
import { deleteImage, uploadImage } from "../../services/cloudinary.service";
import { logger } from "../../utils/logger";
import {
  signAdminAccessToken,
  signAdminResetToken,
  signAdminMfaChallengeToken,
  verifyAdminResetToken,
  verifyAdminMfaChallengeToken,
} from "../../utils/jwt";
import {
  normalizeEmail,
  validatePasswordStrength,
} from "../../utils/passwordPolicy";
import {
  adminAuthRateLimit,
  adminMfaRateLimit,
  passwordResetRateLimit,
} from "../../middleware/rateLimit";
import { recordSecurityEvent } from "../../services/securityAudit.service";
import { requireAdminPassword } from "../../middleware/requireAdminPassword";
import {
  buildOtpauthUrl,
  consumeRecoveryCode,
  generateMfaSecret,
  generateRecoveryCodes,
  isMfaEnforced,
  verifyTotp,
} from "../../services/adminMfa.service";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed"));
    }
    cb(null, true);
  },
});

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── POST /login ───────────────────────────────────────────────────────────────
router.post("/login", adminAuthRateLimit, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body?.email);

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required." });
    }

    const admin = await Admin.findOne({ email });
    if (!admin) {
      recordSecurityEvent({
        category: "AUTH",
        severity: "WARNING",
        action: "admin_login_failure",
        description: "Failed admin login (unknown email).",
        actorType: "admin",
        email,
        req,
      });
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!admin.isActive) {
      recordSecurityEvent({
        category: "AUTH",
        severity: "WARNING",
        action: "admin_login_blocked",
        description: "Admin login blocked — account deactivated.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });
      return res.status(403).json({ message: "Admin account is deactivated." });
    }

    const isPasswordValid = await bcrypt.compare(password, admin.password);
    if (!isPasswordValid) {
      recordSecurityEvent({
        category: "AUTH",
        severity: "WARNING",
        action: "admin_login_failure",
        description: "Failed admin login (bad password).",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const needsMfa = admin.mfaEnabled && Boolean(admin.mfaSecret);
    if (needsMfa) {
      const mfaToken = signAdminMfaChallengeToken(
        String(admin._id),
        admin.tokenVersion ?? 0
      );
      recordSecurityEvent({
        category: "AUTH",
        severity: "INFO",
        action: "admin_mfa_challenge",
        description: "Admin password accepted; MFA challenge issued.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });
      return res.json({
        mfaRequired: true,
        mfaToken,
        message: "MFA verification required",
      });
    }

    if (isMfaEnforced() && admin.role === "superAdmin" && !admin.mfaEnabled) {
      // Allow login but flag that enrollment is required (soft enforce).
      recordSecurityEvent({
        category: "SECURITY",
        severity: "WARNING",
        action: "admin_mfa_enrollment_required",
        description: "superAdmin logged in without MFA while ADMIN_MFA_ENFORCE=true.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });
    }

    const token = signAdminAccessToken(
      String(admin._id),
      admin.role,
      admin.tokenVersion ?? 0
    );

    admin.lastLogin = new Date();
    await admin.save();

    recordSecurityEvent({
      category: "AUTH",
      severity: "INFO",
      action: "admin_login_success",
      description: "Admin logged in successfully.",
      actorType: "admin",
      actorId: admin._id,
      email: admin.email,
      req,
      meta: { role: admin.role, mfa: false },
    });

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
        mfaEnabled: Boolean(admin.mfaEnabled),
        mfaEnrollmentRequired:
          isMfaEnforced() && admin.role === "superAdmin" && !admin.mfaEnabled,
      },
      token,
      message: "Admin login successful",
    });
  } catch (error) {
    logger.error("[ADMIN_AUTH] Login error", { error: String(error) });
    res.status(500).json({ message: "Server error" });
  }
});

// ── POST /mfa/verify — complete login after TOTP / recovery code ──────────────
router.post(
  "/mfa/verify",
  adminMfaRateLimit,
  async (req: Request, res: Response) => {
    try {
      const { mfaToken, code } = req.body;
      if (!mfaToken || typeof mfaToken !== "string" || !code) {
        return res
          .status(400)
          .json({ message: "mfaToken and code are required." });
      }

      let challenge;
      try {
        challenge = verifyAdminMfaChallengeToken(mfaToken);
      } catch {
        return res.status(401).json({ message: "Invalid or expired MFA challenge." });
      }

      const admin = await Admin.findById(challenge.adminId);
      if (!admin || !admin.isActive || !admin.mfaEnabled || !admin.mfaSecret) {
        return res.status(401).json({ message: "Invalid MFA challenge." });
      }
      if ((admin.tokenVersion ?? 0) !== (challenge.tv ?? 0)) {
        return res.status(401).json({ message: "MFA challenge expired." });
      }

      const codeStr = String(code).trim();
      let verified = verifyTotp(codeStr, admin.mfaSecret);
      if (!verified) {
        const consumed = consumeRecoveryCode(
          codeStr,
          admin.mfaRecoveryCodeHashes || []
        );
        if (consumed.ok) {
          admin.mfaRecoveryCodeHashes = consumed.remaining;
          verified = true;
          recordSecurityEvent({
            category: "AUTH",
            severity: "WARNING",
            action: "admin_mfa_recovery_used",
            description: "Admin authenticated with MFA recovery code.",
            actorType: "admin",
            actorId: admin._id,
            email: admin.email,
            req,
          });
        }
      }

      if (!verified) {
        recordSecurityEvent({
          category: "AUTH",
          severity: "WARNING",
          action: "admin_mfa_failure",
          description: "Failed admin MFA verification.",
          actorType: "admin",
          actorId: admin._id,
          email: admin.email,
          req,
        });
        return res.status(401).json({ message: "Invalid MFA code." });
      }

      admin.lastLogin = new Date();
      await admin.save();

      const token = signAdminAccessToken(
        String(admin._id),
        admin.role,
        admin.tokenVersion ?? 0
      );

      recordSecurityEvent({
        category: "AUTH",
        severity: "INFO",
        action: "admin_login_success",
        description: "Admin logged in successfully with MFA.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
        meta: { role: admin.role, mfa: true },
      });

      res.json({
        admin: {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          profileImage: admin.profileImage,
          role: admin.role,
          permissions: admin.permissions,
          lastLogin: admin.lastLogin,
          mfaEnabled: true,
        },
        token,
        message: "Admin login successful",
      });
    } catch (error) {
      logger.error("[ADMIN_AUTH] MFA verify error", { error: String(error) });
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ── POST /logout — revoke sessions by bumping tokenVersion ─────────────────────
router.post("/logout", adminAuth, async (req: Request, res: Response) => {
  try {
    const admin = await Admin.findById(req.admin!._id);
    if (admin) {
      admin.tokenVersion = (admin.tokenVersion ?? 0) + 1;
      await admin.save();
      recordSecurityEvent({
        category: "AUTH",
        severity: "INFO",
        action: "admin_logout",
        description: "Admin logged out; sessions revoked.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });
    }
    res.json({ message: "Admin logged out successfully" });
  } catch (error) {
    logger.error("[ADMIN_AUTH] Logout error", { error: String(error) });
    res.status(500).json({ message: "Server error" });
  }
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
        mfaEnabled: Boolean(admin.mfaEnabled),
        mfaEnrollmentRequired:
          isMfaEnforced() && admin.role === "superAdmin" && !admin.mfaEnabled,
        recoveryCodesRemaining: (admin.mfaRecoveryCodeHashes || []).length,
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
router.post(
  "/forgot-password",
  passwordResetRateLimit,
  async (req: Request, res: Response) => {
    const okMessage = {
      message: "If an admin account exists, a reset link has been sent.",
    };
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        return res.status(400).json({ message: "Email is required." });
      }

      const admin = await Admin.findOne({ email });
      if (!admin) {
        await new Promise((r) => setTimeout(r, 200));
        return res.status(200).json(okMessage);
      }

      const resetToken = signAdminResetToken(String(admin._id));
      admin.passwordResetJtiHash = hashToken(resetToken);
      admin.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      await admin.save();

      const frontendUrl =
        process.env.ADMIN_FRONTEND_URL || "http://localhost:3002";
      const resetLink = `${frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

      await sendPasswordResetEmail(admin.email, resetLink);

      res.status(200).json(okMessage);
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

// ── POST /reset-password ──────────────────────────────────────────────────────
router.post(
  "/reset-password",
  passwordResetRateLimit,
  async (req: Request, res: Response) => {
    try {
      const { token, password } = req.body;

      if (!token || typeof token !== "string" || !password) {
        return res
          .status(400)
          .json({ message: "Token and new password are required." });
      }

      const passwordCheck = validatePasswordStrength(password);
      if (!passwordCheck.ok) {
        return res.status(400).json({ message: passwordCheck.message });
      }

      let decoded;
      try {
        decoded = verifyAdminResetToken(token);
      } catch {
        return res.status(400).json({ message: "Invalid or expired token." });
      }

      const admin = await Admin.findById(decoded.adminId);
      if (!admin) {
        return res.status(400).json({ message: "Invalid or expired token." });
      }

      const tokenHash = hashToken(token);
      if (
        !admin.passwordResetJtiHash ||
        admin.passwordResetJtiHash !== tokenHash ||
        !admin.passwordResetExpiresAt ||
        admin.passwordResetExpiresAt.getTime() < Date.now()
      ) {
        return res.status(400).json({ message: "Invalid or expired token." });
      }

      admin.password = await bcrypt.hash(password, 12);
      admin.tokenVersion = (admin.tokenVersion ?? 0) + 1;
      admin.passwordResetJtiHash = null;
      admin.passwordResetExpiresAt = null;
      await admin.save();

      res.status(200).json({ message: "Password has been successfully reset." });
    } catch (error) {
      res.status(500).json({ message: "Server error" });
    }
  }
);

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
    res.status(500).json({ message: "Failed to upload image" });
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
    res.status(500).json({ message: "Failed to delete image" });
  }
});

// ── MFA enrollment (opt-in; does not lock existing admins) ─────────────────────
router.post(
  "/mfa/setup",
  adminAuth,
  requireAdminPassword,
  async (req: Request, res: Response) => {
    try {
      const admin = await Admin.findById(req.admin!._id);
      if (!admin) return res.status(404).json({ message: "Admin not found" });
      if (admin.mfaEnabled) {
        return res.status(400).json({ message: "MFA is already enabled." });
      }

      const secret = generateMfaSecret();
      admin.mfaPendingSecret = secret;
      await admin.save();

      recordSecurityEvent({
        category: "AUTH",
        severity: "INFO",
        action: "admin_mfa_setup_started",
        description: "Admin started MFA enrollment.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });

      res.json({
        secret,
        otpauthUrl: buildOtpauthUrl(admin.email, secret),
        message: "Scan the otpauth URL with an authenticator app, then confirm with /mfa/enable.",
      });
    } catch (error) {
      logger.error("[ADMIN_AUTH] MFA setup error", { error: String(error) });
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/mfa/enable",
  adminAuth,
  requireAdminPassword,
  adminMfaRateLimit,
  async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      if (!code) {
        return res.status(400).json({ message: "Authenticator code is required." });
      }

      const admin = await Admin.findById(req.admin!._id);
      if (!admin) return res.status(404).json({ message: "Admin not found" });
      if (!admin.mfaPendingSecret) {
        return res
          .status(400)
          .json({ message: "Call /mfa/setup first to begin enrollment." });
      }

      if (!verifyTotp(String(code), admin.mfaPendingSecret)) {
        return res.status(401).json({ message: "Invalid authenticator code." });
      }

      const { codes, hashes } = generateRecoveryCodes(10);
      admin.mfaSecret = admin.mfaPendingSecret;
      admin.mfaPendingSecret = null;
      admin.mfaEnabled = true;
      admin.mfaRecoveryCodeHashes = hashes;
      admin.tokenVersion = (admin.tokenVersion ?? 0) + 1;
      await admin.save();

      recordSecurityEvent({
        category: "AUTH",
        severity: "INFO",
        action: "admin_mfa_enabled",
        description: "Admin enabled MFA.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });

      const token = signAdminAccessToken(
        String(admin._id),
        admin.role,
        admin.tokenVersion
      );

      res.json({
        message: "MFA enabled. Store recovery codes securely; they are shown once.",
        recoveryCodes: codes,
        token,
        admin: {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          mfaEnabled: true,
        },
      });
    } catch (error) {
      logger.error("[ADMIN_AUTH] MFA enable error", { error: String(error) });
      res.status(500).json({ message: "Server error" });
    }
  }
);

router.post(
  "/mfa/disable",
  adminAuth,
  requireAdminPassword,
  adminMfaRateLimit,
  async (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      const admin = await Admin.findById(req.admin!._id);
      if (!admin) return res.status(404).json({ message: "Admin not found" });
      if (!admin.mfaEnabled || !admin.mfaSecret) {
        return res.status(400).json({ message: "MFA is not enabled." });
      }

      if (isMfaEnforced() && admin.role === "superAdmin") {
        return res.status(403).json({
          message:
            "MFA cannot be disabled for superAdmin while ADMIN_MFA_ENFORCE=true.",
        });
      }

      const codeStr = String(code || "").trim();
      let ok = codeStr && verifyTotp(codeStr, admin.mfaSecret);
      if (!ok && codeStr) {
        const consumed = consumeRecoveryCode(
          codeStr,
          admin.mfaRecoveryCodeHashes || []
        );
        ok = consumed.ok;
      }
      if (!ok) {
        return res
          .status(401)
          .json({ message: "Valid authenticator or recovery code required." });
      }

      admin.mfaEnabled = false;
      admin.mfaSecret = null;
      admin.mfaPendingSecret = null;
      admin.mfaRecoveryCodeHashes = [];
      admin.tokenVersion = (admin.tokenVersion ?? 0) + 1;
      await admin.save();

      recordSecurityEvent({
        category: "AUTH",
        severity: "WARNING",
        action: "admin_mfa_disabled",
        description: "Admin disabled MFA.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });

      const token = signAdminAccessToken(
        String(admin._id),
        admin.role,
        admin.tokenVersion
      );

      res.json({
        message: "MFA disabled.",
        token,
        admin: {
          _id: admin._id,
          name: admin.name,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          mfaEnabled: false,
        },
      });
    } catch (error) {
      logger.error("[ADMIN_AUTH] MFA disable error", { error: String(error) });
      res.status(500).json({ message: "Server error" });
    }
  }
);

export default router;
