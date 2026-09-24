import { Request, Response } from "express";
import { Activity } from "../models/Activity";
import { Mood } from "../models/Mood";
import { ChatSession } from "../models/ChatSession";
// Removed AuthRequest as Request is already extended with user in global types
import { startOfDay, endOfDay, subDays, format, eachDayOfInterval } from "date-fns";

export const getWeeklyProgress = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?._id;
    if (!userId) {
      res.status(401).json({ success: false, message: "Not authenticated" });
      return;
    }

    const today = new Date();
    const sevenDaysAgo = startOfDay(subDays(today, 6)); // Last 7 days including today

    // Fetch activities, moods, and sessions for the past 7 days
    const activities = await Activity.find({
      userId,
      timestamp: { $gte: sevenDaysAgo, $lte: endOfDay(today) }
    }).sort({ timestamp: 1 });

    const moods = await Mood.find({
      userId,
      timestamp: { $gte: sevenDaysAgo, $lte: endOfDay(today) }
    }).sort({ timestamp: 1 });

    const sessions = await ChatSession.find({
      userId,
      startTime: { $gte: sevenDaysAgo, $lte: endOfDay(today) }
    });

    // Generate array of last 7 days for grouping
    const daysInterval = eachDayOfInterval({ start: sevenDaysAgo, end: today });

    // Grouping by day (YYYY-MM-DD)
    const dailyData = daysInterval.map(day => {
      const dateStr = format(day, "yyyy-MM-dd");
      const dayLabel = format(day, "EEE"); // Mon, Tue, etc.

      const dayActivities = activities.filter(a => format(new Date(a.timestamp), "yyyy-MM-dd") === dateStr);
      const dayMoods = moods.filter(m => format(new Date(m.timestamp), "yyyy-MM-dd") === dateStr);

      const averageMood = dayMoods.length > 0
        ? dayMoods.reduce((sum, m) => sum + m.score, 0) / dayMoods.length
        : null;

      const totalActivityDuration = dayActivities.reduce((sum, a) => sum + (a.duration || 0), 0);

      return {
        date: dateStr,
        dayLabel,
        activitiesCount: dayActivities.length,
        activityDuration: totalActivityDuration,
        averageMood,
      };
    });

    // Calculate total stats
    const totalActivities = activities.length;
    const totalDuration = activities.reduce((sum, a) => sum + (a.duration || 0), 0);
    const therapySessionsCount = sessions.length;

    // Calculate streak (consecutive days backward from today where there's at least one activity or mood)
    let currentStreak = 0;
    const allRecentLogs = await Activity.find({ userId }).sort({ timestamp: -1 });
    const allRecentMoods = await Mood.find({ userId }).sort({ timestamp: -1 });

    // Quick approximation of streak for the dashboard (just checking the last 14 days)
    const fourteenDaysAgo = startOfDay(subDays(today, 14));
    const recentDays = eachDayOfInterval({ start: fourteenDaysAgo, end: today }).reverse(); // Today backwards

    for (const day of recentDays) {
      const dateStr = format(day, "yyyy-MM-dd");
      const hasActivity = allRecentLogs.some(a => format(new Date(a.timestamp), "yyyy-MM-dd") === dateStr);
      const hasMood = allRecentMoods.some(m => format(new Date(m.timestamp), "yyyy-MM-dd") === dateStr);

      // If it's today and they haven't logged yet, we don't break the streak immediately, 
      // but for simplicity let's just count actual days logged.
      if (hasActivity || hasMood) {
        currentStreak++;
      } else if (format(day, "yyyy-MM-dd") !== format(today, "yyyy-MM-dd")) {
        // Break streak if not today and no log
        break;
      }
    }

    res.json({
      success: true,
      data: {
        dailyData,
        summary: {
          totalActivities,
          totalDuration,
          therapySessionsCount,
          currentStreak
        }
      }
    });

  } catch (error: any) {
    console.error("Error fetching weekly progress:", error);
    res.status(500).json({ success: false, message: error.message || "Failed to fetch progress" });
  }
};
