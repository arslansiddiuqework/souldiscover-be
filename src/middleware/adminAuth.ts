/**
 * Admin Authentication Middleware
 * Validates admin access JWT against the Admin collection ONLY.
 */

import { Request, Response, NextFunction } from "express";
import { Admin, IAdmin } from "../models/Admin";
import { verifyAdminAccessToken } from "../utils/jwt";

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

export const adminAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const header = req.header("Authorization") || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7).trim()
      : header.trim();

    if (!token) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    const decoded = verifyAdminAccessToken(token);
    const admin = await Admin.findById(decoded.adminId);

    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: "Admin not found or deactivated" });
    }

    const currentVersion = (admin as any).tokenVersion ?? 0;
    if ((decoded.tv ?? 0) !== currentVersion) {
      return res
        .status(401)
        .json({ message: "Admin session expired. Please sign in again." });
    }

    req.admin = {
      _id: admin._id as any,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      permissions: admin.permissions,
    };

    next();
  } catch {
    res.status(401).json({ message: "Invalid admin authentication token" });
  }
};

function denyPermission(
  req: Request,
  res: Response,
  permission: string
) {
  void import("../services/securityAudit.service").then(({ recordSecurityEvent }) => {
    recordSecurityEvent({
      category: "SECURITY",
      severity: "WARNING",
      action: "permission_denied",
      description: `Permission denied for ${permission}.`,
      actorType: "admin",
      actorId: req.admin!._id,
      email: req.admin!.email,
      req,
      meta: { permission, path: req.originalUrl, method: req.method },
    });
  });
  return res.status(403).json({
    message: `Insufficient permissions. Required: ${permission}`,
  });
}

export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    if (req.admin.role === "superAdmin") {
      return next();
    }

    if (!req.admin.permissions.includes(permission)) {
      return denyPermission(req, res, permission);
    }

    next();
  };
};

/** Accept any of the listed permissions (backward-compatible migrations). */
export const requireAnyPermission = (...permissions: string[]) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ message: "Admin authentication required" });
    }
    if (req.admin.role === "superAdmin") {
      return next();
    }
    if (permissions.some((p) => req.admin!.permissions.includes(p))) {
      return next();
    }
    return denyPermission(req, res, permissions.join(" | "));
  };
};
