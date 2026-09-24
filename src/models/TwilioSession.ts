import mongoose, { Schema, Document } from "mongoose";

export interface ITwilioSession extends Document {
  identifier: string; // WhatsApp number (e.g. "+1234567890") or CallSid
  type: "whatsapp" | "voice";
  userId: string;
  sessionId: string;
  contactName: string;
  contactWhatsApp?: string; // specific to whatsapp
  contactPhone?: string; // specific to voice
  crisisContext: any; // Storing the full crisis context object
  conversationHistory: any[];
  startedAt: Date;
  expiresAt: Date; // TTL index
}

const TwilioSessionSchema = new Schema<ITwilioSession>(
  {
    identifier: { type: String, required: true, unique: true },
    type: { type: String, enum: ["whatsapp", "voice"], required: true },
    userId: { type: String, required: true },
    sessionId: { type: String, required: true },
    contactName: { type: String, required: true },
    contactWhatsApp: { type: String },
    contactPhone: { type: String },
    crisisContext: { type: Schema.Types.Mixed, required: true },
    conversationHistory: { type: [Object], default: [] },
    startedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// TTL index to automatically delete expired sessions
TwilioSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const TwilioSession =
  mongoose.models.TwilioSession || mongoose.model<ITwilioSession>("TwilioSession", TwilioSessionSchema);
