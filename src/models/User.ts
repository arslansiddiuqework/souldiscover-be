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
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: false },
    authProvider: { type: String, enum: ["local", "google"], default: "local" },
    profileImage: { type: String, default: "" },
    aiName: { type: String, default: "Maya" },
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
  },
  { timestamps: true }
);

export const User = mongoose.model<IUser>("User", UserSchema);
