/**
 * Admin Authentication Middleware
 * ────────────────────────────────
 * Validates adminAccessToken (separate from user accessToken).
 * Authenticates against the Admin collection ONLY.
 * NEVER touches user auth or user JWT.
 */

import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Admin, IAdmin } from "../models/Admin";

interface AdminJwtPayload {
  adminId: string;
  role: string;
}

// Extend Express Request for admin context
declare global {
  namespace Express {
    interface Request {
      admin?: {
        _id: IAdmin["_id"];
        name: string;
        email: string;
        role: string;
        permissions: string[];
      };
    }
  }
}

export const adminAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Look for admin token in Authorization header
    const token = req.header("Authorization")?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || "your-secret-key"
    ) as AdminJwtPayload;

    // CRITICAL: Only look up in Admin collection, never User
    const admin = await Admin.findById(decoded.adminId);

    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: "Admin not found or deactivated" });
    }

    // Attach admin context to request (separate from req.user)
    req.admin = {
      _id: admin._id as any,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
    };

    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid admin authentication token" });
  }
};

/**
 * Permission check middleware factory.
 * Usage: requirePermission("users.block")
 */
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    // superAdmin bypasses all permission checks
    if (req.admin.role === "superAdmin") {
      return next();
    }

    if (!req.admin.permissions.includes(permission)) {
      return res.status(403).json({
        message: `Insufficient permissions. Required: ${permission}`,
      });
    }

    next();
  };
};
