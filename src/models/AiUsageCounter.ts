import mongoose, { Schema, Document, Types } from "mongoose";

export type AiUsageScope = "global_day" | "global_month" | "user_month";

export interface IAiUsageCounter extends Document {
  scope: AiUsageScope;
  /** UTC period key: YYYY-MM-DD (day), YYYY-MM (month), or `${userId}:YYYY-MM` (user). */
  periodKey: string;
  userId?: Types.ObjectId;
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

const AiUsageCounterSchema = new Schema<IAiUsageCounter>(
  {
    scope: {
      type: String,
      enum: ["global_day", "global_month", "user_month"],
      required: true,
    },
    periodKey: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: false },
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

AiUsageCounterSchema.index({ scope: 1, periodKey: 1 }, { unique: true });

export const AiUsageCounter = mongoose.model<IAiUsageCounter>(
  "AiUsageCounter",
  AiUsageCounterSchema
);
