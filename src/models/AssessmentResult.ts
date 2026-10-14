import mongoose, { Document, Schema } from "mongoose";

export interface IAssessmentResult extends Document {
  resultId: string;
  userId: mongoose.Types.ObjectId;
  assessmentId: string;
  assessmentSlug: string;
  instrumentVersion: string;
  title: string;
  answers: Record<string, unknown>[];
  scoring: Record<string, unknown>;
  summary: string;
  saved: boolean;
  completedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const assessmentResultSchema = new Schema(
  {
    resultId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assessmentId: { type: String, required: true, index: true },
    assessmentSlug: { type: String, required: true, index: true },
    instrumentVersion: { type: String, required: true },
    title: { type: String, required: true },
    answers: { type: Schema.Types.Mixed, default: [] },
    scoring: { type: Schema.Types.Mixed, required: true },
    summary: { type: String, default: "" },
    saved: { type: Boolean, default: true },
    completedAt: { type: Date, required: true, default: Date.now },
  },
  { timestamps: true }
);

assessmentResultSchema.index({ userId: 1, resultId: 1 }, { unique: true });
assessmentResultSchema.index({ userId: 1, completedAt: -1 });
assessmentResultSchema.index({ userId: 1, assessmentSlug: 1, completedAt: -1 });

export const AssessmentResult = mongoose.model<IAssessmentResult>(
  "AssessmentResult",
  assessmentResultSchema
);
