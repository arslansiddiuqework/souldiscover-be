import mongoose, { Document, Schema } from "mongoose";

export interface IAdmin extends Document {
  name: string;
  email: string;
  password: string;
  role: "admin" | "superAdmin";
  permissions: string[];
  lastLogin?: Date;
  isActive: boolean;
  profileImage?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSchema = new Schema<IAdmin>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["admin", "superAdmin"],
      default: "admin",
    },
    permissions: {
      type: [String],
      default: [
        "users.read",
        "users.block",
        "sessions.read",
        "emergency.read",
        "analytics.read",
        "logs.read",
      ],
    },
    lastLogin: { type: Date },
    isActive: { type: Boolean, default: true },
    profileImage: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Admin = mongoose.model<IAdmin>("Admin", AdminSchema);
