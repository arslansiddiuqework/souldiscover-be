import { Schema, model, Document, Types } from "mongoose";

// ── Emergency Contact ──────────────────────────────────────────────────────────
interface IContactEntry {
  name: string;
  relationship: string;
  phone?: string;         // E.164 format, e.g. +923001234567
  whatsappNumber?: string; // E.164 format
  preferredContactMethod: "phone" | "whatsapp" | "both";
  priority: number;      // 1 = highest priority
  enabled: boolean;
}

export interface IEmergencyContact extends Document {
  userId: Types.ObjectId;
  consentAccepted: boolean;
  consentAcceptedAt?: Date;
  contacts: IContactEntry[];
  escalationSettings: {
    autoCallEnabled: boolean;
    cooldownHours: number;
    maxPerDay: number;
  };
}

const ContactEntrySchema = new Schema<IContactEntry>({
  name:         { type: String, required: true, trim: true },
  relationship: { type: String, required: true, trim: true },
  preferredContactMethod: { 
    type: String, 
    enum: ["phone", "whatsapp", "both"], 
    default: "phone" 
  },
  phone:        {
    type: String,
    required: function(this: any) { return this.preferredContactMethod !== "whatsapp"; },
    match: [/^\+[1-9]\d{7,14}$/, "Phone must be in E.164 format (e.g. +923001234567)"],
  },
  whatsappNumber: {
    type: String,
    required: function(this: any) { return this.preferredContactMethod === "whatsapp" || this.preferredContactMethod === "both"; },
    match: [/^\+[1-9]\d{7,14}$/, "WhatsApp number must be in E.164 format"],
  },
  priority:     { type: Number, default: 1, min: 1, max: 10 },
  enabled:      { type: Boolean, default: true },
});

const EmergencyContactSchema = new Schema<IEmergencyContact>(
  {
    userId:            { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    consentAccepted:   { type: Boolean, default: false },
    consentAcceptedAt: { type: Date },
    contacts:          { type: [ContactEntrySchema], default: [] },
    escalationSettings: {
      autoCallEnabled: { type: Boolean, default: false },
      cooldownHours:   { type: Number, default: parseInt(process.env.CRISIS_COOLDOWN_HOURS || "6") },
      maxPerDay:       { type: Number, default: parseInt(process.env.MAX_ESCALATIONS_PER_DAY || "3") },
    },
  },
  { timestamps: true }
);

export const EmergencyContact = model<IEmergencyContact>(
  "EmergencyContact",
  EmergencyContactSchema
);
