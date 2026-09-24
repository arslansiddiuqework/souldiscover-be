import { Document, Schema, model, Types } from "mongoose";
import { EmotionMeta, MessageAnalysis } from "../types";

export interface IChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  metadata?: {
    analysis?: MessageAnalysis;
    technique?: string;
    goal?: string;
    currentGoal?: string | null;
    progress?: {
      emotionalState?: string;
      riskLevel?: number;
    };
    emotionMeta?: EmotionMeta | null;
    source?: "text" | "voice";
  };
}

export interface IChatSession extends Document {
  _id: Types.ObjectId;
  sessionId: string;
  userId: Types.ObjectId;
  title: string;
  summary?: string;
  startTime: Date;
  status: "active" | "completed" | "archived";
  messages: IChatMessage[];
}

const chatMessageSchema = new Schema<IChatMessage>({
  role: { type: String, required: true, enum: ["user", "assistant"] },
  content: { type: String, required: true },
  timestamp: { type: Date, required: true },
  metadata: {
    analysis: Schema.Types.Mixed,
    technique: String,
    goal: String,
    currentGoal: String,
    progress: {
      emotionalState: String,
      riskLevel: Number,
    },
    emotionMeta: {
      type: Schema.Types.Mixed,
      default: null,
    },
    source: {
      type: String,
      enum: ["text", "voice"],
      default: "text",
    },
  },
});

const chatSessionSchema = new Schema<IChatSession>({
  sessionId: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  title: { type: String, default: "New Session" },
  summary: { type: String, default: "" },
  startTime: { type: Date, required: true },
  status: {
    type: String,
    required: true,
    enum: ["active", "completed", "archived"],
  },
  messages: [chatMessageSchema],
});

export const ChatSession = model<IChatSession>(
  "ChatSession",
  chatSessionSchema
);
