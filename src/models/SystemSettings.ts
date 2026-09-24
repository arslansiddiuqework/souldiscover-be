import mongoose, { Schema, Document } from "mongoose";

export interface ISystemSettings extends Document {
  crisisEnabled: boolean;
  cooldownHours: number;
  maxPerDay: number;
  createdAt: Date;
  updatedAt: Date;
}

const SystemSettingsSchema = new Schema<ISystemSettings>(
  {
    crisisEnabled: { type: Boolean, default: true },
    cooldownHours: { type: Number, default: 6 },
    maxPerDay: { type: Number, default: 3 },
  },
  { timestamps: true }
);

export const SystemSettings = mongoose.model<ISystemSettings>("SystemSettings", SystemSettingsSchema);
