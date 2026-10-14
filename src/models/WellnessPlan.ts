import mongoose, { Document, Schema } from "mongoose";

export interface IWellnessPlan extends Document {
  planId: string;
  userId: mongoose.Types.ObjectId;
  catalogSlug?: string;
  title: string;
  primaryGoal: string;
  status: "active" | "completed" | "paused";
  challengeLevel: string;
  durationDays: number;
  currentStreak: number;
  longestStreak: number;
  completionRate: number;
  tasksCompleted: number;
  tasksTotal: number;
  assessment: Record<string, unknown>;
  planData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function computeTaskStats(planData: Record<string, unknown>): {
  tasksCompleted: number;
  tasksTotal: number;
  completionRate: number;
} {
  const weeks = (planData.weeks as Array<{ days?: Array<{ tasks?: Array<{ completed?: boolean }> }> }>) || [];
  let tasksTotal = 0;
  let tasksCompleted = 0;
  for (const week of weeks) {
    for (const day of week.days || []) {
      for (const task of day.tasks || []) {
        tasksTotal += 1;
        if (task.completed) tasksCompleted += 1;
      }
    }
  }
  return {
    tasksCompleted,
    tasksTotal,
    completionRate: tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0,
  };
}

const wellnessPlanSchema = new Schema<IWellnessPlan>(
  {
    planId: { type: String, required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    catalogSlug: { type: String, index: true },
    title: { type: String, required: true },
    primaryGoal: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "completed", "paused"],
      default: "active",
      index: true,
    },
    challengeLevel: { type: String, default: "standard" },
    durationDays: { type: Number, default: 21 },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 },
    tasksCompleted: { type: Number, default: 0 },
    tasksTotal: { type: Number, default: 0 },
    assessment: { type: Schema.Types.Mixed, default: {} },
    planData: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

wellnessPlanSchema.index({ userId: 1, planId: 1 }, { unique: true });
wellnessPlanSchema.index({ userId: 1, status: 1, updatedAt: -1 });

wellnessPlanSchema.pre("save", function (next) {
  const stats = computeTaskStats((this.planData as Record<string, unknown>) || {});
  this.tasksCompleted = stats.tasksCompleted;
  this.tasksTotal = stats.tasksTotal;
  this.completionRate = stats.completionRate;
  next();
});

export const WellnessPlan = mongoose.model<IWellnessPlan>("WellnessPlan", wellnessPlanSchema);
export { computeTaskStats };
