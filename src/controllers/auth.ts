import { Request, Response } from "express";
import { sendPasswordResetEmail } from "../services/email.service";
import { User } from "../models/User";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import { logger } from "../utils/logger";

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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

    // Generate JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );



    // Respond with user data and token
    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage || "",
        aiName: user.aiName || "",
        aiBehavior: user.aiBehavior || "",
        aiAvatar: user.aiAvatar || "",
        aiVoice: user.aiVoice || "",
      },
      token,
      message: "Login successful",
    });
  } catch (error) {
    logger.error("Login error:", error);
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
    if (!user) {
      // Return a standard 200 response to prevent email enumeration attacks
      return res.status(200).json({ message: "If an account exists, a reset link has been sent." });
    }

    // Generate a temporary reset token (expires in 15 minutes)
    const resetToken = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "15m" }
    );

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Send email using the nodemailer service
    await sendPasswordResetEmail(user.email, resetLink);

    res.status(200).json({ message: "If an account exists, a reset link has been sent." });
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
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ message: "Google access token is required." });
    }

    // Fetch user info from Google using the access token
    const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: {
        Authorization: `Bearer ${credential}`,
      },
    });

    if (!userInfoResponse.ok) {
      return res.status(400).json({ message: "Invalid Google access token." });
    }

    const payload = await userInfoResponse.json() as any;
    
    if (!payload || !payload.email) {
      return res.status(400).json({ message: "Invalid Google token payload." });
    }

    const { email, name, picture } = payload;

    // Check if user exists
    let user = await User.findOne({ email });

    if (!user) {
      // Create new Google user
      user = new User({
        name: name || "Google User",
        email: email,
        authProvider: "google",
        profileImage: picture || "",
      });
      await user.save();
    } else {
      // If user exists but used local auth previously, we just log them in
      // Optionally you could link accounts, but for now we proceed
      if (user.status === "suspended") {
        return res.status(403).json({ message: "Your account is suspended. Please contact support." });
      }
    }

    // Generate our system JWT token
    const token = jwt.sign(
      { userId: user._id },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "24h" }
    );

    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        profileImage: user.profileImage || "",
        aiName: user.aiName || "",
        aiBehavior: user.aiBehavior || "",
        aiAvatar: user.aiAvatar || "",
        aiVoice: user.aiVoice || "",
      },
      token,
      message: "Google login successful",
    });
  } catch (error) {
    logger.error("Google Auth Error:", error);
    res.status(500).json({ message: "Failed to authenticate with Google." });
  }
};
