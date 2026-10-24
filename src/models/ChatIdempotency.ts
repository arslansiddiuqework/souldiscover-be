import mongoose, { Schema, Document, Types } from "mongoose";

export interface IChatIdempotency extends Document {
  userId: Types.ObjectId;
  key: string;
  sessionId: string;
  createdAt: Date;
}

const ChatIdempotencySchema = new Schema<IChatIdempotency>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  key: { type: String, required: true },
  sessionId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 }, // 24h TTL
});

ChatIdempotencySchema.index({ userId: 1, key: 1 }, { unique: true });

export const ChatIdempotency = mongoose.model<IChatIdempotency>(
  "ChatIdempotency",
  ChatIdempotencySchema
);
