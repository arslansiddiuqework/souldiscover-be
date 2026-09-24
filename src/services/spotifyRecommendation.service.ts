import { logger } from "../utils/logger";
import { searchPlaylists, SpotifyPlaylist } from "./spotify.service";

/**
 * Mapping of emotional states or intents to Spotify search queries.
 * This abstracts the AI's intent to actual search terminology.
 */
const MOOD_TO_QUERY_MAP: Record<string, string> = {
  "Stress": "Calm Piano",
  "Anxiety": "Meditation Music",
  "Sadness": "Uplifting Music", // If sad -> consolidate/happy
  "Loneliness": "Comfort Music",
  "Burnout": "Deep Focus",
  "Anger": "Nature Sounds",
  "Panic": "Breathing Music",
  "Sleep": "Sleep Sounds",
  "Depression": "Calm Confident", // If depressed -> calm and confident
  "Happy": "Positive Energy", // If happy -> maintain positive vibe
};

/**
 * Default fallback if the intent doesn't match the map
 */
const DEFAULT_QUERY = "Relaxing Music";

/**
 * Generate Spotify recommendations based on AI's music intent.
 * 
 * @param mood The mood or intent specified by the AI (e.g. "Calm Piano" or a key like "Stress")
 * @returns Array of recommended Spotify playlists
 */
export async function getMusicRecommendations(mood: string): Promise<SpotifyPlaylist[]> {
  try {
    // 1. Determine the search query
    // If the AI outputs a direct known key (like "Stress"), map it. 
    // Otherwise, assume the AI outputted the mood name directly (like "Calm Piano").
    // We do a case-insensitive check against the map keys.
    const normalizedMood = mood.trim().toLowerCase();
    
    let searchQuery = DEFAULT_QUERY;

    const matchedKey = Object.keys(MOOD_TO_QUERY_MAP).find(
      key => key.toLowerCase() === normalizedMood
    );

    if (matchedKey) {
      searchQuery = MOOD_TO_QUERY_MAP[matchedKey];
    } else {
      // The AI might have outputted something like "Nature Sounds" directly, use it if it's sensible length.
      searchQuery = mood.length < 50 ? mood : DEFAULT_QUERY;
    }

    logger.info(`Fetching Spotify recommendations for query: "${searchQuery}" (Original Intent: "${mood}")`);

    // 2. Search Spotify
    // We request 3 playlists as specified in the plan
    const playlists = await searchPlaylists(searchQuery, 3);
    
    return playlists;
  } catch (error) {
    logger.error("Error generating music recommendations", { error, mood });
    return []; // Fail gracefully, don't break the chat
  }
}
