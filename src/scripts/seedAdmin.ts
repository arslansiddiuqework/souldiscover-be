/**
 * Admin Seed Script
 * ─────────────────
 * Creates initial admin and superAdmin accounts.
 * Run: npx ts-node src/scripts/seedAdmin.ts
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { Admin } from "../models/Admin";

const MONGODB_URI = process.env.MONGODB_URI;

async function seedAdmin() {
  if (!MONGODB_URI) {
    console.error("❌ MONGODB_URI not found in .env");
    process.exit(1);
  }

  try {
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // 1. Seed Super Admin
    const existingSuper = await Admin.findOne({ email: "muhammadahmedasif13@gmail.com" });
    if (!existingSuper) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      const superAdmin = new Admin({
        name: "Muhammad Ahmed",
        email: "muhammadahmedasif13@gmail.com",
        password: hashedPassword,
        role: "superAdmin",
        permissions: [
          "users.read",
          "users.block",
          "sessions.read",
          "emergency.read",
          "analytics.read",
          "logs.read",
          "settings.read",
          "settings.update",
        ],
        isActive: true,
      });
      await superAdmin.save();
      console.log("✅ Super Admin created successfully: muhammadahmedasif13@gmail.com");
    } else {
      console.log("ℹ️  Super Admin already exists — skipping.");
    }

    // 2. Seed Standard Admin (with restricted permissions)
    const existingStandard = await Admin.findOne({ email: "admin@aurapulse.com" });
    if (!existingStandard) {
      const hashedPassword = await bcrypt.hash("admin123", 10);
      const standardAdmin = new Admin({
        name: "Soul Discovery Assistant",
        email: "admin@aurapulse.com",
        password: hashedPassword,
        role: "admin",
        permissions: [
          "users.read",
          "users.block",
          "sessions.read",
          "emergency.read",
          "analytics.read",
          "logs.read",
        ],
        isActive: true,
      });
      await standardAdmin.save();
      console.log("✅ Standard Admin created successfully: admin@aurapulse.com");
    } else {
      // Ensure the existing standard admin does not have settings permissions
      existingStandard.permissions = [
        "users.read",
        "users.block",
        "sessions.read",
        "emergency.read",
        "analytics.read",
        "logs.read",
      ];
      await existingStandard.save();
      console.log("✅ Synchronized existing Standard Admin permissions.");
    }

    console.log("");
    console.log("🎉 Seeding complete!");
    console.log("   Super Admin:    muhammadahmedasif13@gmail.com (Password: admin123)");
    console.log("   Standard Admin: admin@aurapulse.com (Password: admin123)");
    console.log("");

    await mongoose.disconnect();
  } catch (error) {
    console.error("❌ Seed failed:", error);
    process.exit(1);
  }
}

seedAdmin();
