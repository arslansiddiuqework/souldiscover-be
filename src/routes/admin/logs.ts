/**
 * Admin Logs Routes
 * ─────────────────
 * Real audit feed: EscalationLog (CRISIS) + SecurityAuditEvent (AUTH/SECURITY/SYSTEM/ADMIN).
 * No synthetic / fabricated rows.
 *
 * GET /api/admin/logs — Paginated system logs
 */

import { Router, Request, Response } from "express";
import { EscalationLog } from "../../models/EscalationLog";
import { SecurityAuditEvent } from "../../models/SecurityAuditEvent";
import { User } from "../../models/User";
import { adminAuth, requirePermission } from "../../middleware/adminAuth";
import { logger } from "../../utils/logger";

const router = Router();
router.use(adminAuth);

type UiSeverity = "INFO" | "WARNING" | "CRITICAL";

router.get("/", requirePermission("logs.read"), async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const category = ((req.query.category as string) || "ALL").toUpperCase();
    const severity = ((req.query.severity as string) || "ALL").toUpperCase();
    const skip = (page - 1) * limit;

    const wantCrisis = category === "ALL" || category === "CRISIS";
    const wantAudit =
      category === "ALL" ||
      category === "AUTH" ||
      category === "SECURITY" ||
      category === "SYSTEM" ||
      category === "ADMIN";

    const crisisFilter: Record<string, unknown> = {};
    if (wantCrisis) {
      let allowedRiskLevels = ["MEDIUM", "HIGH", "CRITICAL"];
      if (severity === "CRITICAL") allowedRiskLevels = ["CRITICAL"];
      else if (severity === "WARNING") allowedRiskLevels = ["HIGH"];
      else if (severity === "INFO") allowedRiskLevels = ["LOW", "MEDIUM"];
      crisisFilter.riskLevel = { $in: allowedRiskLevels };
    }

    const auditFilter: Record<string, unknown> = {};
    if (wantAudit) {
      if (category !== "ALL") {
        auditFilter.category = category;
      } else {
        auditFilter.category = { $in: ["AUTH", "SECURITY", "SYSTEM", "ADMIN"] };
      }
      if (severity !== "ALL") {
        auditFilter.severity = severity;
      }
    }

    const fetchLimit = skip + limit;

    const [crisisLogs, crisisTotal, auditLogs, auditTotal] = await Promise.all([
      wantCrisis
        ? EscalationLog.find(crisisFilter).sort({ createdAt: -1 }).limit(fetchLimit)
        : Promise.resolve([]),
      wantCrisis ? EscalationLog.countDocuments(crisisFilter) : Promise.resolve(0),
      wantAudit
        ? SecurityAuditEvent.find(auditFilter).sort({ createdAt: -1 }).limit(fetchLimit)
        : Promise.resolve([]),
      wantAudit ? SecurityAuditEvent.countDocuments(auditFilter) : Promise.resolve(0),
    ]);

    const crisisUserIds = crisisLogs.map((l) => l.userId).filter(Boolean);
    const users = crisisUserIds.length
      ? await User.find({ _id: { $in: crisisUserIds } })
          .select("name profileImage")
          .lean()
      : [];
    const userMap = new Map(users.map((u) => [String(u._id), u]));

    const mappedCrisis = crisisLogs.map((log) => {
      const user = userMap.get(String(log.userId));
      let mappedSev: UiSeverity = "INFO";
      if (log.riskLevel === "CRITICAL") mappedSev = "CRITICAL";
      else if (log.riskLevel === "HIGH") mappedSev = "WARNING";

      return {
        _id: String(log._id),
        timestamp: log.createdAt,
        category: "CRISIS" as const,
        severity: mappedSev,
        description: `${log.riskLevel} risk escalation for ${user?.name || "Unknown"} — ${log.outcome} (${log.escalationReason || "N/A"})`,
        operator: log.contactCalled || "System",
        riskLevel: log.riskLevel,
        outcome: log.outcome,
        userId: log.userId ? String(log.userId) : undefined,
        sessionId: log.sessionId,
        userProfileImage: user?.profileImage || "",
        action: "escalation",
      };
    });

    const mappedAudit = auditLogs.map((ev) => ({
      _id: String(ev._id),
      timestamp: ev.createdAt,
      category: ev.category,
      severity: ev.severity as UiSeverity,
      description: ev.description,
      operator:
        ev.actorType === "admin"
          ? "Admin"
          : ev.actorType === "user"
          ? "User"
          : "System",
      userId: ev.actorId ? String(ev.actorId) : undefined,
      action: ev.action,
      email: ev.email,
      ip: ev.ip,
    }));

    const merged = [...mappedCrisis, ...mappedAudit].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    const pageSlice = merged.slice(skip, skip + limit);
    const total = crisisTotal + auditTotal;

    res.json({
      logs: pageSlice,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    logger.error("[ADMIN_LOGS] Logs error", { error: String(error) });
    res.status(500).json({ message: "Failed to fetch logs" });
  }
});

export default router;
