import { logger } from "../utils/logger";

let accessToken: string | null = null;
let tokenExpirationTime: number | null = null;

export interface SpotifyPlaylist {
  id: string;
  title: string;
  description: string;
  imageUrl: string;
  spotifyUrl: string;
}

/**
 * Invalidate the cached Spotify token (call on 401 responses)
 */
function invalidateToken(): void {
  accessToken = null;
  tokenExpirationTime = null;
}

/**
 * Authenticate with Spotify using the Client Credentials Flow
 */
export async function getSpotifyAccessToken(): Promise<string | null> {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    logger.warn("Spotify credentials missing in environment variables.");
    return null;
  }

  // Check if we have a valid cached token
  if (accessToken && tokenExpirationTime && Date.now() < tokenExpirationTime) {
    return accessToken;
  }

  // Clear stale state before fetching fresh token
  accessToken = null;
  tokenExpirationTime = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify Auth Error ${response.status}: ${response.statusText} — ${body}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    if (!data.access_token) {
      throw new Error("Spotify returned no access_token in response");
    }

    accessToken = data.access_token;
    // Subtract 60 seconds as a buffer for expiration
    tokenExpirationTime = Date.now() + (data.expires_in - 60) * 1000;

    logger.info("✅ Spotify: Token acquired successfully");
    return accessToken;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to authenticate with Spotify: ${msg}`);
    return null;
  }
}

/**
 * Search Spotify for playlists
 * @param query The search query (e.g., "Calm Piano", "Meditation")
 * @param limit The number of playlists to return
 * @param isRetry Internal flag — set to true to prevent infinite retry loops
 */
export async function searchPlaylists(
  query: string,
  limit: number = 3,
  isRetry: boolean = false
): Promise<SpotifyPlaylist[]> {
  try {
    const token = await getSpotifyAccessToken();
    if (!token) {
      logger.warn("Spotify: No access token available, skipping search.");
      return [];
    }

    const searchUrl = new URL("https://api.spotify.com/v1/search");
    searchUrl.searchParams.append("q", query);
    searchUrl.searchParams.append("type", "playlist");
    searchUrl.searchParams.append("limit", limit.toString());
    
    // Add a random offset (0 to 19) to ensure different results each time
    const randomOffset = Math.floor(Math.random() * 20);
    searchUrl.searchParams.append("offset", randomOffset.toString());

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(searchUrl.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    // If we get a 401, our cached token is invalid — invalidate and retry once
    if (response.status === 401 && !isRetry) {
      logger.warn("Spotify: 401 Unauthorized on search — invalidating token and retrying...");
      invalidateToken();
      return searchPlaylists(query, limit, true);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Spotify Search Error ${response.status}: ${response.statusText} — ${body}`);
    }

    const data = (await response.json()) as {
      playlists?: { items?: any[] };
    };

    if (!data.playlists || !data.playlists.items) {
      logger.warn("Spotify: Search returned no playlists", { query });
      return [];
    }

    const results = data.playlists.items
      .filter((item: any) => item !== null)
      .map((item: any) => ({
        id: item.id,
        title: item.name,
        description: item.description || "",
        imageUrl: item.images && item.images.length > 0 ? item.images[0].url : "",
        spotifyUrl: item.external_urls?.spotify || "",
      }));

    logger.info(`✅ Spotify: Found ${results.length} playlists for query "${query}"`);
    return results;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to search Spotify playlists: ${msg}`, { query });
    return [];
  }
}
