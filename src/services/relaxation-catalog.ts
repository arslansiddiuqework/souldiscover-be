/**
 * Manually curated local ambient fallback used when FREESOUND_API_KEY is
 * missing or Freesound is unavailable. These paths are already referenced by
 * Calm games under the frontend /public/sounds folder — we do not rehost
 * Freesound originals here.
 */

import {
  CATEGORY_QUERIES,
  type RelaxationCategoryId,
  type RelaxationTrack,
} from "./freesound.service";

type CuratedEntry = {
  id: string;
  title: string;
  creator: string;
  category: RelaxationCategoryId;
  /** Served from the Next.js public folder */
  publicPath: string;
  duration: number;
  licence: string;
  licenceUrl: string;
  attributionRequired: boolean;
};

const CURATED: CuratedEntry[] = [
  {
    id: "local-rain",
    title: "Gentle Rain",
    creator: "Soul Discovery ambient",
    category: "rain-nature",
    publicPath: "/sounds/rain%20sound.mp3",
    duration: 120,
    licence: "Bundled app asset",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false,
  },
  {
    id: "local-waves",
    title: "Ocean Waves",
    creator: "Soul Discovery ambient",
    category: "rain-nature",
    publicPath: "/sounds/waves.mp3",
    duration: 120,
    licence: "Bundled app asset",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false,
  },
  {
    id: "local-birds",
    title: "Forest Birds",
    creator: "Soul Discovery ambient",
    category: "rain-nature",
    publicPath: "/sounds/birds.mp3",
    duration: 90,
    licence: "Bundled app asset",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false,
  },
  {
    id: "local-wind",
    title: "Soft Wind",
    creator: "Soul Discovery ambient",
    category: "ambient",
    publicPath: "/sounds/wind.mp3",
    duration: 90,
    licence: "Bundled app asset",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false,
  },
  {
    id: "local-leaves",
    title: "Rustling Leaves",
    creator: "Soul Discovery ambient",
    category: "ambient",
    publicPath: "/sounds/leaves.mp3",
    duration: 90,
    licence: "Bundled app asset",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false,
  },
  {
    id: "local-campfire",
    title: "Campfire Crackles",
    creator: "Soul Discovery ambient",
    category: "sleep-unwind",
    publicPath: "/sounds/campfire.mp3",
    duration: 120,
    licence: "Bundled app asset",
    licenceUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
    attributionRequired: false,
  },
];

function toTrack(entry: CuratedEntry): RelaxationTrack {
  return {
    id: entry.id,
    source: "local",
    title: entry.title,
    duration: entry.duration,
    creator: entry.creator,
    category: entry.category,
    previewUrl: entry.publicPath,
    artworkUrl: null,
    pageUrl: null,
    tags: [entry.category],
    licence: entry.licence,
    licenceUrl: entry.licenceUrl,
    commercialUseAllowed: true,
    attributionRequired: entry.attributionRequired,
    attributionText: `${entry.title} — ${entry.creator}`,
  };
}

export function listCategories() {
  return (Object.keys(CATEGORY_QUERIES) as RelaxationCategoryId[]).map(
    (id) => ({
      id,
      label: CATEGORY_QUERIES[id].label,
    })
  );
}

export function getCuratedTracks(
  category?: RelaxationCategoryId
): RelaxationTrack[] {
  const filtered = category
    ? CURATED.filter((e) => e.category === category)
    : CURATED;
  // If a category has no curated files, return all so the UI is never empty
  const list = filtered.length ? filtered : CURATED;
  return list.map(toTrack);
}
