import mongoose, { Document, Schema } from "mongoose";

export interface IAssessmentSession extends Document {
  sessionId: string;
  userId?: mongoose.Types.ObjectId;
  assessmentId: string;
  assessmentSlug: string;
  instrumentVersion: string;
  status: "in_progress" | "completed" | "abandoned";
  answers: Record<string, unknown>[];
  currentQuestionId?: string;
  acknowledgedNotDiagnosis: boolean;
  submissionToken: string;
  completedResultId?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const assessmentSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    assessmentId: { type: String, required: true },
    assessmentSlug: { type: String, required: true, index: true },
    instrumentVersion: { type: String, required: true },
    status: {
      type: String,
      enum: ["in_progress", "completed", "abandoned"],
      default: "in_progress",
      index: true,
    },
    answers: { type: Schema.Types.Mixed, default: [] },
    currentQuestionId: { type: String },
    acknowledgedNotDiagnosis: { type: Boolean, default: false },
    submissionToken: { type: String, required: true },
    completedResultId: { type: String },
    expiresAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

assessmentSessionSchema.index({ userId: 1, status: 1, updatedAt: -1 });

export const AssessmentSession = mongoose.model<IAssessmentSession>(
  "AssessmentSession",
  assessmentSessionSchema
);
