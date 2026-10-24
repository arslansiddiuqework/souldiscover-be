import { Request, Response } from "express";
import crypto from "crypto";
import { sendPasswordResetEmail } from "../services/email.service";
import { User, IUser } from "../models/User";
import bcrypt from "bcryptjs";
import { logger } from "../utils/logger";
import {
  GoogleProfile,
  resolveGoogleProfile,
} from "../services/googleIdentity.service";
import {
  signUserAccessToken,
  signUserResetToken,
  verifyUserResetToken,
} from "../utils/jwt";
import {
  normalizeEmail,
  validatePasswordStrength,
} from "../utils/passwordPolicy";
import { recordSecurityEvent } from "../services/securityAudit.service";

function serializeAuthUser(user: IUser) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    profileImage: user.profileImage || "",
    aiName: user.aiName || "",
    aiBehavior: user.aiBehavior || "",
    aiAvatar: user.aiAvatar || "",
    aiVoice: user.aiVoice || "",
    websiteTourCompleted:
      user.websiteTourCompleted === undefined
        ? true
        : Boolean(user.websiteTourCompleted),
  };
}

function issueUserToken(user: IUser) {
  return signUserAccessToken(String(user._id), user.tokenVersion ?? 0);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export const register = async (req: Request, res: Response) => {
  try {
    const { name, password } = req.body;
    const email = normalizeEmail(req.body?.email);

    if (!name || typeof name !== "string" || !name.trim() || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required." });
    }

    if (name.trim().length > 100) {
      return res.status(400).json({ message: "Name is too long." });
    }

    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ message: passwordCheck.message });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "Email already in use." });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = new User({
      name: name.trim(),
      email,
      password: hashedPassword,
      websiteTourCompleted: false,
    });
    await user.save();

    recordSecurityEvent({
      category: "AUTH",
      severity: "INFO",
      action: "register",
      description: "New user registered with email/password.",
      actorType: "user",
      actorId: user._id,
      email: user.email,
      req,
    });

    res.status(201).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage || "",
      },
      message: "User registered successfully.",
    });
  } catch (error) {
    logger.error("Registration error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const email = normalizeEmail(req.body?.email);

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    const user = await User.findOne({ email });
    // Uniform failure message to reduce enumeration
    const invalid = { message: "Invalid email or password." };

    if (!user) {
      recordSecurityEvent({
        category: "AUTH",
        severity: "WARNING",
        action: "login_failure",
        description: "Failed login attempt (unknown email).",
        actorType: "user",
        email,
        req,
      });
      return res.status(401).json(invalid);
    }

    if (user.status === "suspended") {
      recordSecurityEvent({
        category: "AUTH",
        severity: "WARNING",
        action: "login_blocked_suspended",
        description: "Login blocked for suspended account.",
        actorType: "user",
        actorId: user._id,
        email: user.email,
        req,
      });
      return res.status(403).json({
        message: "Your account is suspended. Please contact support.",
      });
    }

    if (!user.password) {
      // Same status as bad password — avoid revealing Google-only accounts.
      recordSecurityEvent({
        category: "AUTH",
        severity: "WARNING",
        action: "login_failure",
        description: "Failed login attempt (no local password).",
        actorType: "user",
        actorId: user._id,
        email: user.email,
        req,
      });
      return res.status(401).json(invalid);
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      recordSecurityEvent({
        category: "AUTH",
        severity: "WARNING",
        action: "login_failure",
        description: "Failed login attempt (bad password).",
        actorType: "user",
        actorId: user._id,
        email: user.email,
        req,
      });
      return res.status(401).json(invalid);
    }

    const token = issueUserToken(user);

    recordSecurityEvent({
      category: "AUTH",
      severity: "INFO",
      action: "login_success",
      description: "User logged in with email/password.",
      actorType: "user",
      actorId: user._id,
      email: user.email,
      req,
    });

    res.json({
      user: serializeAuthUser(user),
      token,
      message: "Login successful",
    });
  } catch (error) {
    logger.error("Login error:", error);
    const msg = error instanceof Error ? error.message : "";
    if (
      msg.includes("buffering timed out") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("MongoServerSelectionError") ||
      msg.includes("Could not connect")
    ) {
      return res.status(503).json({
        message: "Database temporarily unavailable. Please try again shortly.",
      });
    }
    res.status(500).json({ message: "Internal server error" });
  }
};

export const logout = async (_req: Request, res: Response) => {
  // Stateless JWT — client discards the token. Password changes bump tokenVersion.
  res.json({ message: "Logged out successfully" });
};

export const forgotPassword = async (req: Request, res: Response) => {
  const okMessage = {
    message: "If an account exists, a reset link has been sent.",
  };

  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = await User.findOne({ email });
    if (!user || !user.password) {
      // Constant-ish delay to reduce timing oracle
      await new Promise((r) => setTimeout(r, 200));
      return res.status(200).json(okMessage);
    }

    const resetToken = signUserResetToken(String(user._id));
    user.passwordResetJtiHash = hashToken(resetToken);
    user.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetLink = `${frontendUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

    await sendPasswordResetEmail(user.email, resetLink);

    recordSecurityEvent({
      category: "AUTH",
      severity: "INFO",
      action: "password_reset_request",
      description: "Password reset email requested.",
      actorType: "user",
      actorId: user._id,
      email: user.email,
      req,
    });

    res.status(200).json(okMessage);
  } catch (error) {
    logger.error("Forgot password error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
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
      decoded = verifyUserResetToken(token);
    } catch {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    const tokenHash = hashToken(token);
    if (
      !user.passwordResetJtiHash ||
      user.passwordResetJtiHash !== tokenHash ||
      !user.passwordResetExpiresAt ||
      user.passwordResetExpiresAt.getTime() < Date.now()
    ) {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    user.password = await bcrypt.hash(password, 12);
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.passwordResetJtiHash = null;
    user.passwordResetExpiresAt = null;
    await user.save();

    recordSecurityEvent({
      category: "AUTH",
      severity: "INFO",
      action: "password_reset_success",
      description: "Password reset completed; sessions invalidated.",
      actorType: "user",
      actorId: user._id,
      email: user.email,
      req,
    });

    res.status(200).json({ message: "Password has been successfully reset." });
  } catch (error) {
    logger.error("Reset password error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const googleAuth = async (req: Request, res: Response) => {
  try {
    const credential =
      typeof req.body?.credential === "string"
        ? req.body.credential.trim()
        : typeof req.body?.access_token === "string"
          ? req.body.access_token.trim()
          : "";

    if (!credential) {
      return res
        .status(400)
        .json({ message: "Google credential is required." });
    }

    let profile: GoogleProfile;
    try {
      profile = await resolveGoogleProfile(credential);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Invalid Google credential.";
      logger.warn("Google credential rejected:", message);
      return res.status(400).json({ message: "Invalid Google credential." });
    }

    if (profile.emailVerified === false) {
      return res.status(400).json({
        message: "Please verify your Google email address, then try again.",
      });
    }

    const email = profile.email.toLowerCase();
    let user = await User.findOne({ email });

    if (!user) {
      user = new User({
        name: profile.name || "Google User",
        email,
        authProvider: "google",
        profileImage: profile.picture || "",
        websiteTourCompleted: false,
      });
      await user.save();
    } else {
      if (user.status === "suspended") {
        return res.status(403).json({
          message: "Your account is suspended. Please contact support.",
        });
      }

      let dirty = false;
      if (user.authProvider !== "google" && !user.password) {
        user.authProvider = "google";
        dirty = true;
      }
      if (!user.profileImage && profile.picture) {
        user.profileImage = profile.picture;
        dirty = true;
      }
      if (dirty) {
        await user.save();
      }
    }

    const token = issueUserToken(user);

    recordSecurityEvent({
      category: "AUTH",
      severity: "INFO",
      action: "google_login",
      description: "User authenticated with Google.",
      actorType: "user",
      actorId: user._id,
      email: user.email,
      req,
      meta: { authProvider: "google" },
    });

    res.json({
      user: serializeAuthUser(user),
      token,
      message: "Google login successful",
    });
  } catch (error) {
    logger.error("Google Auth Error:", error);
    res.status(500).json({ message: "Failed to authenticate with Google." });
  }
};
