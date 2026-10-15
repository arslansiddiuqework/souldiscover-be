import { Request, Response } from "express";
import { Activity } from "../models/Activity";
import { Mood } from "../models/Mood";
import { ChatSession } from "../models/ChatSession";
// Removed AuthRequest as Request is already extended with user in global types
import { startOfDay, endOfDay, subDays, format, eachDayOfInterval } from "date-fns";

/** Minutes for games logged without a duration field. */
const GAME_DURATION_BY_NAME: Record<string, number> = {
  breathing: 5,
  garden: 10,
  forest: 15,
  waves: 8,
  rain: 5,
  campfire: 5,
};

/**
 * Prefer stored duration; otherwise estimate so Progress Duration isn't stuck at 0m
 * when clients historically logged games/check-ins with duration: 0.
 */
function effectiveActivityMinutes(activity: {
  type?: string;
  name?: string;
  duration?: number | null;
}): number {
  const stored = Number(activity.duration);
  if (Number.isFinite(stored) && stored > 0) return stored;

  const type = String(activity.type || "").toLowerCase();
  const name = String(activity.name || "").toLowerCase();

  if (type === "game" || GAME_DURATION_BY_NAME[name] != null) {
    return GAME_DURATION_BY_NAME[name] ?? 5;
  }

  switch (type) {
    case "meditation":
      return 10;
    case "exercise":
      return 20;
    case "walking":
      return 15;
    case "journaling":
      return 10;
    case "reading":
      return 15;
    case "music":
      return 10;
    case "therapy":
      return 15;
    default:
      return 5;
  }
}

/** Chat time from first → last message (capped), so therapy time counts toward Duration. */
function sessionDurationMinutes(session: {
  startTime: Date;
  messages?: { timestamp?: Date }[];
}): number {
  const start = new Date(session.startTime).getTime();
  if (!Number.isFinite(start)) return 0;

  const timestamps = (session.messages || [])
    .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN))
    .filter((t) => Number.isFinite(t)) as number[];

  const end = timestamps.length > 0 ? Math.max(...timestamps) : start;
  const mins = Math.round((end - start) / 60000);
  if (mins <= 0) {
    // Brief session with messages still counts as at least 1 minute of engagement
    return timestamps.length > 0 ? Math.max(1, Math.min(timestamps.length, 5)) : 0;
  }
  return Math.min(mins, 180);
}

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
      const daySessions = sessions.filter(
        (s) => format(new Date(s.startTime), "yyyy-MM-dd") === dateStr
      );

      const averageMood = dayMoods.length > 0
        ? dayMoods.reduce((sum, m) => sum + m.score, 0) / dayMoods.length
        : null;

      const activityMinutes = dayActivities.reduce(
        (sum, a) => sum + effectiveActivityMinutes(a),
        0
      );
      const chatMinutes = daySessions.reduce(
        (sum, s) => sum + sessionDurationMinutes(s),
        0
      );
      const totalActivityDuration = activityMinutes + chatMinutes;

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
    const activityMinutesTotal = activities.reduce(
      (sum, a) => sum + effectiveActivityMinutes(a),
      0
    );
    const chatMinutesTotal = sessions.reduce(
      (sum, s) => sum + sessionDurationMinutes(s),
      0
    );
    const totalDuration = activityMinutesTotal + chatMinutesTotal;
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
