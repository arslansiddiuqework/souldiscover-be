import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User";

interface JwtPayload {
  userId: string;
}

/**
 * Attaches req.user when a valid token is present; otherwise continues as guest.
 */
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const token = req.header("Authorization")?.replace("Bearer ", "");
    if (!token) return next();

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    ) as JwtPayload;
    const user = await User.findById(decoded.userId);
    if (!user || user.status === "suspended") return next();

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
