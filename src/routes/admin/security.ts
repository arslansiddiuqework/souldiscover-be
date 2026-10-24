/**
 * Admin Security Monitoring
 * ─────────────────────────
 * Aggregates real SecurityAuditEvent + EscalationLog signals.
 * GET /api/admin/security/overview
 */

import { Router, Request, Response } from "express";
import { SecurityAuditEvent } from "../../models/SecurityAuditEvent";
import { EscalationLog } from "../../models/EscalationLog";
import { Admin } from "../../models/Admin";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

router.get(
  "/overview",
  requirePermission("logs.read"),
  async (_req: Request, res: Response) => {
    try {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [
        failedLogins,
        mfaFailures,
        permissionDenials,
        reauthFailures,
        recentSecurityEvents,
        crisisThisWeek,
        adminsWithoutMfa,
        mfaEnabledCount,
        adminTotal,
      ] = await Promise.all([
        SecurityAuditEvent.countDocuments({
          createdAt: { $gte: since },
          action: { $in: ["admin_login_failure", "login_failure"] },
        }),
        SecurityAuditEvent.countDocuments({
          createdAt: { $gte: since },
          action: "admin_mfa_failure",
        }),
        SecurityAuditEvent.countDocuments({
          createdAt: { $gte: since },
          action: "permission_denied",
        }),
        SecurityAuditEvent.countDocuments({
          createdAt: { $gte: since },
          action: "reauth_failure",
        }),
        SecurityAuditEvent.find({
          createdAt: { $gte: since },
          severity: { $in: ["WARNING", "CRITICAL"] },
        })
          .sort({ createdAt: -1 })
          .limit(25)
          .select(
            "category severity action description actorType email createdAt ip"
          )
          .lean(),
        EscalationLog.countDocuments({ createdAt: { $gte: since } }),
        Admin.countDocuments({
          isActive: true,
          role: "superAdmin",
          mfaEnabled: { $ne: true },
        }),
        Admin.countDocuments({ isActive: true, mfaEnabled: true }),
        Admin.countDocuments({ isActive: true }),
      ]);

      const roleChanges = await SecurityAuditEvent.countDocuments({
        createdAt: { $gte: since },
        action: {
          $in: [
            "admin_mfa_enabled",
            "admin_mfa_disabled",
            "settings_updated",
            "user_status_change",
            "user_deleted",
          ],
        },
      });

      res.json({
        windowDays: 7,
        metrics: {
          failedLogins,
          mfaFailures,
          permissionDenials,
          reauthFailures,
          crisisThisWeek,
          privilegedActions: roleChanges,
          activeAdmins: adminTotal,
          adminsWithMfa: mfaEnabledCount,
          superAdminsWithoutMfa: adminsWithoutMfa,
        },
        warnings: [
          ...(adminsWithoutMfa > 0
            ? [
                {
                  code: "SUPERADMIN_MFA_MISSING",
                  severity: "WARNING" as const,
                  message: `${adminsWithoutMfa} active superAdmin account(s) do not have MFA enabled.`,
                },
              ]
            : []),
          ...(failedLogins >= 20
            ? [
                {
                  code: "ELEVATED_LOGIN_FAILURES",
                  severity: "WARNING" as const,
                  message: `${failedLogins} failed login events in the last 7 days.`,
                },
              ]
            : []),
        ],
        recentEvents: recentSecurityEvents.map((e) => ({
          _id: String(e._id),
          category: e.category,
          severity: e.severity,
          action: e.action,
          description: e.description,
          actorType: e.actorType,
          email: e.email,
          ip: e.ip,
          createdAt: e.createdAt,
        })),
      });
    } catch (error) {
      logger.error("[ADMIN_SECURITY] Overview error", { error: String(error) });
      res.status(500).json({ message: "Failed to load security overview" });
    }
  }
);

export default router;
