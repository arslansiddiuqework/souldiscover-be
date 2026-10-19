import { Router, Request, Response } from "express";
import { searchPlaylists } from "../services/spotify.service";
import {
  CATEGORY_QUERIES,
  isFreesoundConfigured,
  searchRelaxationTracks,
  type RelaxationCategoryId,
} from "../services/freesound.service";
import {
  getCuratedTracks,
  listCategories,
} from "../services/relaxation-catalog";
import { logger } from "../utils/logger";
import { auth } from "../middleware/auth";
import { Mood } from "../models/Mood";
import { User } from "../models/User";

const router = Router();

const CATEGORY_IDS = new Set(Object.keys(CATEGORY_QUERIES));

function parseCategory(raw: unknown): RelaxationCategoryId | null {
  if (typeof raw !== "string") return null;
  return CATEGORY_IDS.has(raw) ? (raw as RelaxationCategoryId) : null;
}

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

/**
 * @route GET /api/music/relaxation/categories
 * @desc List Free Relaxation Music Library categories
 */
router.get("/relaxation/categories", auth, (_req: Request, res: Response) => {
  return res.json({
    success: true,
    categories: listCategories(),
    freesoundConfigured: isFreesoundConfigured(),
    licenceNote:
      "Only Creative Commons 0 and Attribution (CC BY) previews are returned. Attribution NonCommercial is excluded. Preview streams are used — originals are never rehosted.",
  });
});

/**
 * @route GET /api/music/relaxation
 * @desc Search licensed relaxation tracks (Freesound previews + local fallback)
 * Query: category, page, pageSize
 */
router.get("/relaxation", auth, async (req: Request, res: Response) => {
  try {
    const category =
      parseCategory(req.query.category) || ("rain-nature" as RelaxationCategoryId);
    const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
    const pageSize = Math.min(
      24,
      Math.max(1, parseInt(String(req.query.pageSize || "12"), 10) || 12)
    );

    if (isFreesoundConfigured()) {
      try {
        const result = await searchRelaxationTracks({ category, page, pageSize });
        if (result.tracks.length > 0) {
          return res.json({
            success: true,
            category,
            categories: listCategories(),
            ...result,
            fallback: false,
            attributionNotice:
              "Play tracks that require attribution only with the shown credit. Licences are verified server-side; NonCommercial sounds are never included.",
          });
        }
        logger.warn(
          `Freesound returned 0 licensed tracks for ${category}; using curated fallback`
        );
      } catch (error) {
        const status = (error as { status?: number }).status;
        logger.error("Freesound relaxation search failed", error);
        if (status === 429) {
          // Still serve curated fallback so Calm toolkit stays usable
        }
      }
    }

    const tracks = getCuratedTracks(category);
    return res.json({
      success: true,
      category,
      categories: listCategories(),
      tracks,
      count: tracks.length,
      page: 1,
      pageSize: tracks.length,
      source: "local" as const,
      fallback: true,
      freesoundConfigured: isFreesoundConfigured(),
      attributionNotice:
        isFreesoundConfigured()
          ? "Freesound had no usable licensed previews for this category. Showing bundled ambient assets instead."
          : "FREESOUND_API_KEY is not set. Showing bundled ambient assets. Add a Freesound API key on the backend to load the full library.",
    });
  } catch (error) {
    logger.error("Error in GET /api/music/relaxation", error);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export default router;
