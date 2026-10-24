import mongoose, { Document, Schema, Types } from "mongoose";

export type AuditCategory = "AUTH" | "SECURITY" | "SYSTEM" | "ADMIN";
export type AuditSeverity = "INFO" | "WARNING" | "CRITICAL";
export type AuditActorType = "user" | "admin" | "system";

export interface ISecurityAuditEvent extends Document {
  category: AuditCategory;
  severity: AuditSeverity;
  action: string;
  description: string;
  actorType: AuditActorType;
  actorId?: Types.ObjectId;
  email?: string;
  ip?: string;
  meta?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const SecurityAuditEventSchema = new Schema<ISecurityAuditEvent>(
  {
    category: {
      type: String,
      enum: ["AUTH", "SECURITY", "SYSTEM", "ADMIN"],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["INFO", "WARNING", "CRITICAL"],
      required: true,
      index: true,
    },
    action: { type: String, required: true, index: true },
    description: { type: String, required: true, maxlength: 500 },
    actorType: {
      type: String,
      enum: ["user", "admin", "system"],
      required: true,
    },
    actorId: { type: Schema.Types.ObjectId, required: false },
    email: { type: String, required: false, lowercase: true, trim: true },
    ip: { type: String, required: false },
    meta: { type: Schema.Types.Mixed, required: false },
  },
  { timestamps: true }
);

SecurityAuditEventSchema.index({ createdAt: -1 });
SecurityAuditEventSchema.index({ category: 1, createdAt: -1 });

export const SecurityAuditEvent = mongoose.model<ISecurityAuditEvent>(
  "SecurityAuditEvent",
  SecurityAuditEventSchema
);
