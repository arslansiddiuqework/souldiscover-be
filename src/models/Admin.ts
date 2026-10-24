import mongoose, { Document, Schema } from "mongoose";
import { DEFAULT_ADMIN_PERMISSIONS } from "../utils/adminPermissions";

export interface IAdmin extends Document {
  name: string;
  email: string;
  password: string;
  role: "admin" | "superAdmin";
  permissions: string[];
  lastLogin?: Date;
  isActive: boolean;
  profileImage?: string;
  tokenVersion: number;
  passwordResetJtiHash?: string | null;
  passwordResetExpiresAt?: Date | null;
  /** TOTP MFA — optional; enrollment is opt-in unless ADMIN_MFA_ENFORCE=true */
  mfaEnabled: boolean;
  mfaSecret?: string | null;
  mfaRecoveryCodeHashes?: string[];
  mfaPendingSecret?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const AdminSchema = new Schema<IAdmin>(
  {
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ["admin", "superAdmin"],
      default: "admin",
    },
    permissions: {
      type: [String],
      default: () => [...DEFAULT_ADMIN_PERMISSIONS],
    },
    lastLogin: { type: Date },
    isActive: { type: Boolean, default: true },
    profileImage: { type: String, default: "" },
    tokenVersion: { type: Number, default: 0 },
    passwordResetJtiHash: { type: String, default: null },
    passwordResetExpiresAt: { type: Date, default: null },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, default: null },
    mfaRecoveryCodeHashes: { type: [String], default: [] },
    mfaPendingSecret: { type: String, default: null },
  },
  { timestamps: true }
);

export const Admin = mongoose.model<IAdmin>("Admin", AdminSchema);
