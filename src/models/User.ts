import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  name: string;
  email: string;
  password?: string;
  authProvider: "local" | "google";
  profileImage: string;
  aiName: string;
  aiBehavior: "supportive" | "friendly" | "motivational" | "calm";
  aiAvatar: string;
  aiVoice: string;
  status: "active" | "suspended";
  /** First-time website tour dismissed or completed */
  websiteTourCompleted: boolean;
  /** Incremented on password change to invalidate older access JWTs */
  tokenVersion: number;
  /** One-time password-reset JTI (hashed) — cleared after successful reset */
  passwordResetJtiHash?: string | null;
  passwordResetExpiresAt?: Date | null;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: false },
    authProvider: { type: String, enum: ["local", "google"], default: "local" },
    profileImage: { type: String, default: "" },
    aiName: { type: String, default: "Soul Discovery" },
    aiBehavior: { 
      type: String, 
      enum: ["supportive", "friendly", "motivational", "calm"], 
      default: "supportive" 
    },
    aiAvatar: { type: String, default: "" },
    aiVoice: { type: String, default: "" },
    status: { 
      type: String, 
      enum: ["active", "suspended"], 
      default: "active" 
    },
    websiteTourCompleted: {
      type: Boolean,
      default: false,
    },
    tokenVersion: { type: Number, default: 0 },
    passwordResetJtiHash: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);
