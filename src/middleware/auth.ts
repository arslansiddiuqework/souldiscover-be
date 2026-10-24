import { Request, Response, NextFunction } from "express";
import { User } from "../models/User";
import { verifyUserAccessToken } from "../utils/jwt";

export const auth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const header = req.header("Authorization") || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7).trim()
      : header.trim();

    if (!token) {
      return res.status(401).json({ message: "Authentication required" });
    }

    const decoded = verifyUserAccessToken(token);
    const user = await User.findById(decoded.userId);

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.status === "suspended") {
      return res
        .status(403)
        .json({
          message: "Your account is suspended. Please contact support.",
        });
    }

    const currentVersion = user.tokenVersion ?? 0;
    if ((decoded.tv ?? 0) !== currentVersion) {
      return res.status(401).json({ message: "Session expired. Please sign in again." });
    }

    req.user = {
      _id: user._id as any,
      email: user.email,
      name: user.name,
      profileImage: user.profileImage,
      aiName: user.aiName,
      aiBehavior: user.aiBehavior,
      aiAvatar: user.aiAvatar,
      aiVoice: user.aiVoice,
      websiteTourCompleted:
        user.websiteTourCompleted === undefined
          ? true
          : Boolean(user.websiteTourCompleted),
    };
    next();
  } catch {
    res.status(401).json({ message: "Invalid authentication token" });
  }
};
