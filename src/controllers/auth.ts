import { Request, Response } from "express";
import { sendPasswordResetEmail } from "../services/email.service";
import { User, IUser } from "../models/User";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { logger } from "../utils/logger";
import {
  GoogleProfile,
  resolveGoogleProfile,
} from "../services/googleIdentity.service";

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
    // Absent flag = legacy account (do not force the tour). Explicit false = new user.
    websiteTourCompleted:
      user.websiteTourCompleted === undefined
        ? true
        : Boolean(user.websiteTourCompleted),
  };
}

function issueUserToken(user: IUser) {
  return jwt.sign(
    { userId: user._id },
    process.env.JWT_SECRET || "your-secret-key",
    { expiresIn: "24h" }
  );
}

export const register = async (req: Request, res: Response) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res
        .status(400)
        .json({ message: "Name, email, and password are required." });
    }
    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "Email already in use." });
    }
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Create user
    const user = new User({ name, email, password: hashedPassword });
    await user.save();
    // Respond
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
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    // Check if user is suspended
    if (user.status === "suspended") {
      return res.status(403).json({ message: "Your account is suspended. Please contact support." });
    }

    // If the user signed up with Google, they won't have a password
    if (!user.password) {
      return res.status(401).json({ message: "This account was created with Google. Please use 'Continue with Google' to log in." });
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    const token = issueUserToken(user);

    res.json({
      user: serializeAuthUser(user),
      token,
      message: "Login successful",
    });
  } catch (error) {
    logger.error("Login error:", error);
    const msg = error instanceof Error ? error.message : "";
    // Surface common Atlas / serverless connection failures clearly
    if (
      msg.includes("buffering timed out") ||
      msg.includes("ECONNREFUSED") ||
      msg.includes("MongoServerSelectionError") ||
      msg.includes("Could not connect")
    ) {
      return res.status(503).json({
        message:
          "Database unavailable. On Vercel, set MONGODB_URI to Atlas and allow Network Access (0.0.0.0/0).",
      });
    }
    res.status(500).json({ message: "Internal server error" });
  }
};

export const logout = async (_req: Request, res: Response) => {
  // Stateless JWT — client simply discards the token
  res.json({ message: "Logged out successfully" });
};

export const forgotPassword = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required." });
    }

    const user = await User.findOne({ email });
    // Always return the same message to prevent email enumeration.
    const okMessage = {
      message: "If an account exists, a reset link has been sent.",
    };

    if (!user) {
      return res.status(200).json(okMessage);
    }

    // Google-only accounts have no password — they should use Continue with Google.
    if (!user.password) {
      return res.status(200).json(okMessage);
    }

    const resetToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "15m" }
    );

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    await sendPasswordResetEmail(user.email, resetLink);

    res.status(200).json(okMessage);
  } catch (error) {
    logger.error("Forgot password error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: "Token and new password are required." });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key") as { userId: string };
    } catch (err) {
      return res.status(400).json({ message: "Invalid or expired token." });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);
    user.password = hashedPassword;
    await user.save();

    // Optionally: You could invalidate existing sessions here

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
      return res.status(400).json({ message });
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
      // Link Google onto an existing email/password account without wiping the password.
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
