import { Request } from "express";
import { Types } from "mongoose";
import {
  SecurityAuditEvent,
  AuditCategory,
  AuditSeverity,
  AuditActorType,
} from "../models/SecurityAuditEvent";
import { logger } from "../utils/logger";

function clientIp(req?: Request): string | undefined {
  if (!req) return undefined;
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 64);
  }
  return (req.ip || req.socket?.remoteAddress || "").slice(0, 64) || undefined;
}

/**
 * Fire-and-forget security audit write. Never throws to callers.
 * Do not pass passwords, tokens, or journal/chat content in meta.
 */
export function recordSecurityEvent(input: {
  category: AuditCategory;
  severity: AuditSeverity;
  action: string;
  description: string;
  actorType: AuditActorType;
  actorId?: string | Types.ObjectId | null;
  email?: string | null;
  req?: Request;
  meta?: Record<string, unknown>;
}): void {
  void (async () => {
    try {
      await SecurityAuditEvent.create({
        category: input.category,
        severity: input.severity,
        action: input.action.slice(0, 80),
        description: input.description.slice(0, 500),
        actorType: input.actorType,
        actorId: input.actorId
          ? new Types.ObjectId(String(input.actorId))
          : undefined,
        email: input.email ? String(input.email).toLowerCase().slice(0, 254) : undefined,
        ip: clientIp(input.req),
        meta: input.meta,
      });
    } catch (err) {
      logger.warn("[SECURITY_AUDIT] Failed to persist event", {
        action: input.action,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  })();
}
