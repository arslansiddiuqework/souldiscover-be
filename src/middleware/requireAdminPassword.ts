/**
 * Step-up authentication: require the acting admin's current password
 * for high-risk mutations (delete user, settings change, MFA changes).
 */

import { Request, Response, NextFunction } from "express";
import bcrypt from "bcryptjs";
import { Admin } from "../models/Admin";
import { recordSecurityEvent } from "../services/securityAudit.service";

export async function requireAdminPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.admin?._id) {
      return res.status(401).json({ message: "Admin authentication required" });
    }

    const password =
      typeof req.body?.confirmPassword === "string"
        ? req.body.confirmPassword
        : typeof req.body?.password === "string" && req.path.includes("mfa")
          ? req.body.password
          : "";

    if (!password) {
      return res.status(401).json({
        message: "Re-authentication required. Provide confirmPassword.",
        code: "REAUTH_REQUIRED",
      });
    }

    const admin = await Admin.findById(req.admin._id);
    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: "Admin not found or deactivated" });
    }

    const ok = await bcrypt.compare(password, admin.password);
    if (!ok) {
      recordSecurityEvent({
        category: "SECURITY",
        severity: "WARNING",
        action: "reauth_failure",
        description: "Failed step-up password verification for privileged action.",
        actorType: "admin",
        actorId: admin._id,
        email: admin.email,
        req,
      });
      return res.status(401).json({
        message: "Re-authentication failed.",
        code: "REAUTH_FAILED",
      });
    }

    // Do not forward password fields into downstream handlers' business logic.
    if (req.body && typeof req.body === "object") {
      delete req.body.confirmPassword;
      // Keep password only for MFA setup flows that may still need it — strip after compare.
      if (req.body.password && req.path.includes("mfa")) {
        /* already verified */
      }
    }

    next();
  } catch {
    res.status(500).json({ message: "Re-authentication error" });
  }
}
