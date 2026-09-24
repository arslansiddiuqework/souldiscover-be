import { Router, Request, Response } from "express";
import { searchPlaylists } from "../services/spotify.service";
import { logger } from "../utils/logger";
import { auth } from "../middleware/auth";
import { Mood } from "../models/Mood";
import { User } from "../models/User";

const router = Router();

/**
 * Maps a numerical mood score (0-100) and AI personality to a Spotify search query
 */
function getQueryForMoodScore(score: number, aiBehavior: string = "supportive"): string {
  if (score < 30) {
    // Depressed / Very Sad
    if (aiBehavior === "motivational") return "Uplifting Motivation";
    if (aiBehavior === "calm") return "Deep Healing";
    if (aiBehavior === "friendly") return "Comforting Pop";
    return "Calm Confident";
  } else if (score < 60) {
    // Sad / Stressed / Neutral
    if (aiBehavior === "motivational") return "Uplifting Workout";
    if (aiBehavior === "calm") return "Peaceful Acoustic";
    if (aiBehavior === "supportive") return "Happy Vibes";
    return "Uplifting Music";
  } else {
    // Happy / Good
    if (aiBehavior === "calm") return "Happy Chill";
    if (aiBehavior === "motivational") return "High Energy Motivation";
    return "Positive Energy";
  }
}

/**
 * @route GET /api/music/dashboard
 * @desc Get music recommendations based on user's most recent mood score and AI personality
 */
router.get("/dashboard", auth, async (req: Request, res: Response) => {
  try {
    // Note: req.user is populated by the auth middleware
    const userId = (req as any).user._id;
    
    // Fetch the user to get their AI personality
    const user = await User.findById(userId);
    const aiBehavior = user?.aiBehavior || "supportive";

    // Fetch the user's most recent mood
    const latestMood = await Mood.findOne({ userId }).sort({ createdAt: -1 });
    
    // Default to 50 if they have never tracked their mood
    const score = latestMood ? latestMood.score : 50;

    const searchQuery = getQueryForMoodScore(score, aiBehavior);
    logger.info(`Fetching dashboard Spotify recommendations for user ${userId} (Score: ${score}, AI: ${aiBehavior}, Query: "${searchQuery}")`);

    const playlists = await searchPlaylists(searchQuery, 3);
    
    return res.json({
      success: true,
      query: searchQuery,
      playlists
    });
  } catch (error) {
    logger.error("Error in GET /api/music/dashboard", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
