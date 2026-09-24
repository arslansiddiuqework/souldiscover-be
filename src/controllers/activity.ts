import { Request, Response, NextFunction } from "express";
import { Activity } from "../models/Activity";
import { logger } from "../utils/logger";

// Log a new activity
export const logActivity = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    console.error("USER UNDEFINED - AUTH FAILED");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { type, name, description, duration } = req.body;
    const userId = req.user._id;


    const activity = new Activity({
      userId,
      type,
      name,
      description,
      duration,
      timestamp: new Date(),
    });

    await activity.save();
    logger.info(`Activity logged for user ${userId}`);

    res.status(201).json({
      success: true,
      data: activity,
    });
  } catch (err: any) {
    console.error("ERROR (logActivity):", err);
    res.status(500).json({
      message: "Internal error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};

// Get all activities for the user
export const getActivities = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    console.error("USER UNDEFINED - AUTH FAILED");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id;

    const activities = await Activity.find({ userId }).sort({ timestamp: -1 });

    res.status(200).json({
      success: true,
      data: activities,
    });
  } catch (err: any) {
    console.error("ERROR (getActivities):", err);
    res.status(500).json({
      message: "Internal error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};

// Get today's activities for the user
export const getTodayActivities = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    console.error("USER UNDEFINED - AUTH FAILED");
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const userId = req.user._id;

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const activities = await Activity.find({
      userId,
      timestamp: { $gte: startOfDay, $lte: endOfDay },
    }).sort({ timestamp: -1 });

    res.status(200).json({
      success: true,
      data: activities,
    });
  } catch (err: any) {
    console.error("ERROR (getTodayActivities):", err);
    res.status(500).json({
      message: "Internal error",
      error: err.message,
      stack: process.env.NODE_ENV === "development" ? err.stack : undefined
    });
  }
};

// Delete an activity
export const deleteActivity = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { activityId } = req.params;
    const userId = req.user._id;

    const deletedActivity = await Activity.findOneAndDelete({
      _id: activityId,
      userId,
    });

    if (!deletedActivity) {
      return res.status(404).json({
        success: false,
        message: "Activity not found or unauthorized",
      });
    }

    logger.info(`Activity ${activityId} deleted for user ${userId}`);

    res.status(200).json({
      success: true,
      message: "Activity deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
