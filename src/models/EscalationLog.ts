import { Schema, model, Document, Types } from "mongoose";
import { RiskLevel } from "../services/crisis/crisis-types";

export type EscalationDeliveryStatus =
  | "pending"
  | "accepted"
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "unknown";

export interface IEscalationLog extends Document {
  userId: Types.ObjectId | string;
  sessionId: string;
  riskLevel: RiskLevel;
  crisisRiskScore: number;
  escalationReason: string;
  contactCalled?: string;
  contactPhone?: string;
  contactWhatsApp?: string;
  /** Historical Twilio Call SID — retained for audit compatibility */
  callSid?: string;
  /** TextBee (or other SMS) batch id */
  smsBatchId?: string;
  channel?: "sms" | "voice" | "whatsapp";
  provider?: string;
  deliveryStatus?: EscalationDeliveryStatus;
  voiceStatus?: "available" | "VOICE_UNAVAILABLE";
  outcome: "initiated" | "completed" | "failed" | "blocked";
  error?: string;
  duration?: number;
  callStatus?: string;
  /** Historical Twilio error code — retained */
  twilioErrorCode?: string;
  providerErrorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const EscalationLogSchema = new Schema<IEscalationLog>(
  {
    userId: { type: Schema.Types.Mixed, required: true, index: true },
    sessionId: { type: String, required: true },
    riskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      required: true,
    },
    crisisRiskScore: { type: Number, required: true },
    escalationReason: { type: String, default: "" },
    contactCalled: { type: String },
    contactPhone: { type: String },
    contactWhatsApp: { type: String },
    callSid: { type: String },
    smsBatchId: { type: String, index: true },
    channel: {
      type: String,
      enum: ["sms", "voice", "whatsapp"],
    },
    provider: { type: String },
    deliveryStatus: {
      type: String,
      enum: [
        "pending",
        "accepted",
        "queued",
        "sent",
        "delivered",
        "failed",
        "unknown",
      ],
    },
    voiceStatus: {
      type: String,
      enum: ["available", "VOICE_UNAVAILABLE"],
    },
    outcome: {
      type: String,
      enum: ["initiated", "completed", "failed", "blocked"],
      default: "initiated",
    },
    error: { type: String },
    duration: { type: Number },
    callStatus: { type: String },
    twilioErrorCode: { type: String },
    providerErrorCode: { type: String },
  },
  { timestamps: true }
);

EscalationLogSchema.index({ userId: 1, createdAt: -1 });

export const EscalationLog = model<IEscalationLog>(
  "EscalationLog",
  EscalationLogSchema
);
