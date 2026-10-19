/**
 * Freesound APIv2 client (server-only).
 * Docs: https://freesound.org/docs/api/
 *
 * Auth: Token via Authorization header (FREESOUND_API_KEY).
 * Playback: documented preview URLs only — never rehost originals.
 * Rate limits (standard): 60 req/min, 2000 req/day.
 */

import { logger } from "../utils/logger";

const FREESOUND_BASE = "https://freesound.org/apiv2";
const REQUEST_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/** Licences we may surface on a commercial wellness product. */
export type AllowedLicence =
  | "Creative Commons 0"
  | "Attribution";

export type LicencePolicy = {
  licence: AllowedLicence;
  commercialUseAllowed: boolean;
  attributionRequired: boolean;
  licenceUrl: string;
};

const LICENCE_POLICY: Record<AllowedLicence, LicencePolicy> = {
  "Creative Commons 0": {
    licence: "Creative Commons 0",
    commercialUseAllowed: true,
    attributionRequired: false,
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  },
  Attribution: {
    licence: "Attribution",
    commercialUseAllowed: true,
    attributionRequired: true,
    licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
};

export type RelaxationCategoryId =
  | "rain-nature"
  | "calm-piano"
  | "meditation"
  | "sleep-unwind"
  | "ambient";

export type RelaxationTrack = {
  id: string;
  source: "freesound" | "local";
  title: string;
  duration: number;
  creator: string;
  category: RelaxationCategoryId;
  previewUrl: string;
  artworkUrl: string | null;
  pageUrl: string | null;
  tags: string[];
  licence: string;
  licenceUrl: string;
  commercialUseAllowed: boolean;
  attributionRequired: boolean;
  attributionText: string;
};

type FreesoundSound = {
  id: number;
  name?: string;
  username?: string;
  duration?: number;
  license?: string;
  tags?: string[];
  url?: string;
  previews?: {
    "preview-hq-mp3"?: string;
    "preview-lq-mp3"?: string;
    "preview-hq-ogg"?: string;
    "preview-lq-ogg"?: string;
  };
  images?: {
    waveform_m?: string;
    spectral_m?: string;
  };
};

type CacheEntry = { expires: number; payload: unknown };

const cache = new Map<string, CacheEntry>();
let windowStart = Date.now();
let windowCount = 0;
const MAX_PER_MINUTE = 50; // stay under Freesound's 60/min

function getApiKey(): string | null {
  const key = process.env.FREESOUND_API_KEY?.trim();
  return key || null;
}

export function isFreesoundConfigured(): boolean {
  return Boolean(getApiKey());
}

export function resolveLicencePolicy(
  licenceRaw: string | undefined | null
): LicencePolicy | null {
  if (!licenceRaw) return null;
  const normalised = licenceRaw.trim();
  if (normalised in LICENCE_POLICY) {
    return LICENCE_POLICY[normalised as AllowedLicence];
  }
  // Defensive aliases
  if (/^cc0$/i.test(normalised) || /creative commons 0/i.test(normalised)) {
    return LICENCE_POLICY["Creative Commons 0"];
  }
  if (/^attribution$/i.test(normalised) || /^cc[- ]?by$/i.test(normalised)) {
    return LICENCE_POLICY.Attribution;
  }
  // Explicitly reject NonCommercial and unknown
  return null;
}

export function isSafePreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === "freesound.org" ||
      host.endsWith(".freesound.org") ||
      host === "cdn.freesound.org"
    );
  } catch {
    return false;
  }
}

function throttleOk(): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= MAX_PER_MINUTE) return false;
  windowCount += 1;
  return true;
}

async function freesoundFetch(
  path: string,
  params: Record<string, string>
): Promise<unknown> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("FREESOUND_API_KEY is not configured");
  }
  if (!throttleOk()) {
    const err = new Error("Freesound rate limit reached — try again shortly");
    (err as Error & { status?: number }).status = 429;
    throw err;
  }

  const qs = new URLSearchParams(params);
  const url = `${FREESOUND_BASE}${path}?${qs.toString()}`;
  const cacheKey = url;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    return hit.payload;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Token ${apiKey}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      logger.warn(`Freesound ${response.status}: ${detail.slice(0, 200)}`);
      const err = new Error(
        response.status === 429
          ? "Freesound rate limit exceeded"
          : `Freesound request failed (${response.status})`
      );
      (err as Error & { status?: number }).status = response.status;
      throw err;
    }

    const payload = await response.json();
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload });
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export const CATEGORY_QUERIES: Record<
  RelaxationCategoryId,
  { label: string; query: string; filterExtra: string }
> = {
  "rain-nature": {
    label: "Rain & Nature",
    query: "rain nature forest birds",
    filterExtra: 'tag:(rain OR nature OR forest OR birds OR water)',
  },
  "calm-piano": {
    label: "Calm Piano",
    query: "calm piano soft",
    filterExtra: "tag:piano",
  },
  meditation: {
    label: "Meditation",
    query: "meditation calm drone",
    filterExtra: 'tag:(meditation OR calm OR drone OR zen)',
  },
  "sleep-unwind": {
    label: "Sleep & Unwind",
    query: "sleep unwind night soft",
    filterExtra: 'tag:(sleep OR night OR lullaby OR soft)',
  },
  ambient: {
    label: "Ambient Sounds",
    query: "ambient atmosphere pad",
    filterExtra: 'tag:(ambient OR atmosphere OR pad OR texture)',
  },
};

function mapSound(
  sound: FreesoundSound,
  category: RelaxationCategoryId
): RelaxationTrack | null {
  const policy = resolveLicencePolicy(sound.license);
  if (!policy || !policy.commercialUseAllowed) return null;

  const preview =
    sound.previews?.["preview-hq-mp3"] ||
    sound.previews?.["preview-lq-mp3"] ||
    sound.previews?.["preview-hq-ogg"] ||
    sound.previews?.["preview-lq-ogg"];

  if (!preview || !isSafePreviewUrl(preview)) return null;

  const title = (sound.name || `Sound ${sound.id}`).trim();
  const creator = (sound.username || "Unknown").trim();
  const attributionText = policy.attributionRequired
    ? `"${title}" by ${creator} on Freesound — ${policy.licence}`
    : `"${title}" by ${creator} on Freesound (CC0)`;

  return {
    id: `fs-${sound.id}`,
    source: "freesound",
    title,
    duration: typeof sound.duration === "number" ? sound.duration : 0,
    creator,
    category,
    previewUrl: preview,
    artworkUrl: sound.images?.waveform_m || sound.images?.spectral_m || null,
    pageUrl: sound.url || `https://freesound.org/s/${sound.id}/`,
    tags: Array.isArray(sound.tags) ? sound.tags.slice(0, 8) : [],
    licence: policy.licence,
    licenceUrl: policy.licenceUrl,
    commercialUseAllowed: policy.commercialUseAllowed,
    attributionRequired: policy.attributionRequired,
    attributionText,
  };
}

export async function searchRelaxationTracks(opts: {
  category: RelaxationCategoryId;
  page?: number;
  pageSize?: number;
}): Promise<{
  tracks: RelaxationTrack[];
  count: number;
  page: number;
  pageSize: number;
  source: "freesound";
}> {
  const page = Math.max(1, opts.page || 1);
  const pageSize = Math.min(24, Math.max(1, opts.pageSize || 12));
  const cat = CATEGORY_QUERIES[opts.category];
  if (!cat) {
    throw new Error("Unknown category");
  }

  // Only CC0 + Attribution (never NonCommercial). Duration 20s–10m.
  const licenceFilter =
    'license:("Creative Commons 0" OR Attribution) duration:[20 TO 600]';
  const filter = `${licenceFilter} ${cat.filterExtra}`;

  const data = (await freesoundFetch("/search/", {
    query: cat.query,
    filter,
    fields:
      "id,name,username,duration,license,tags,url,previews,images",
    page: String(page),
    page_size: String(pageSize),
    sort: "rating_desc",
  })) as { count?: number; results?: FreesoundSound[] };

  const results = Array.isArray(data.results) ? data.results : [];
  const tracks = results
    .map((s) => mapSound(s, opts.category))
    .filter((t): t is RelaxationTrack => Boolean(t));

  return {
    tracks,
    count: typeof data.count === "number" ? data.count : tracks.length,
    page,
    pageSize,
    source: "freesound",
  };
}
