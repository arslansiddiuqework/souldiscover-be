import { Request, Response, NextFunction } from "express";
import { User } from "../models/User";
import { verifyUserAccessToken } from "../utils/jwt";

/**
 * Attaches req.user when a valid access token is present; otherwise continues as guest.
 * Password-reset tokens are ignored (treated as guest).
 */
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const header = req.header("Authorization") || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7).trim()
      : header.trim();
    if (!token) return next();

    const decoded = verifyUserAccessToken(token);
    const user = await User.findById(decoded.userId);
    if (!user || user.status === "suspended") return next();

    const currentVersion = user.tokenVersion ?? 0;
    if ((decoded.tv ?? 0) !== currentVersion) return next();

    req.user = {
      _id: user._id as any,
      email: user.email,
      name: user.name,
      profileImage: user.profileImage,
      aiName: user.aiName,
      aiBehavior: user.aiBehavior,
      aiAvatar: user.aiAvatar,
      aiVoice: user.aiVoice,
    };
    next();
  } catch {
    next();
  }
};
