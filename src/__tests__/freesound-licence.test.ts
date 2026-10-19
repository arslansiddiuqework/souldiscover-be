/**
 * Licence + URL safety tests for Free Relaxation Music Library.
 * Run: npx ts-node src/__tests__/freesound-licence.test.ts
 */

import {
  isSafePreviewUrl,
  resolveLicencePolicy,
} from "../services/freesound.service";
import { getCuratedTracks, listCategories } from "../services/relaxation-catalog";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nFreesound licence & relaxation catalog tests\n");

assert(
  resolveLicencePolicy("Creative Commons 0")?.commercialUseAllowed === true,
  "CC0 allows commercial use"
);
assert(
  resolveLicencePolicy("Creative Commons 0")?.attributionRequired === false,
  "CC0 does not require attribution"
);
assert(
  resolveLicencePolicy("Attribution")?.commercialUseAllowed === true,
  "Attribution (CC BY) allows commercial use with credit"
);
assert(
  resolveLicencePolicy("Attribution")?.attributionRequired === true,
  "Attribution requires credit"
);
assert(
  resolveLicencePolicy("Attribution NonCommercial") === null,
  "NonCommercial is rejected"
);
assert(
  resolveLicencePolicy("Unknown License XYZ") === null,
  "Unknown licences are rejected"
);

assert(
  isSafePreviewUrl("https://cdn.freesound.org/previews/123/abc.mp3") === true,
  "cdn.freesound.org preview is safe"
);
assert(
  isSafePreviewUrl("https://freesound.org/data/previews/1.mp3") === true,
  "freesound.org preview is safe"
);
assert(
  isSafePreviewUrl("http://cdn.freesound.org/previews/1.mp3") === false,
  "http preview rejected"
);
assert(
  isSafePreviewUrl("https://evil.example/steal.mp3") === false,
  "foreign hosts rejected"
);

const categories = listCategories();
assert(categories.length === 5, "five relaxation categories");
assert(
  categories.some((c) => c.id === "rain-nature"),
  "includes Rain & Nature"
);

const curated = getCuratedTracks();
assert(curated.length >= 4, "curated fallback has tracks");
assert(
  curated.every((t) => t.source === "local" && t.previewUrl.startsWith("/")),
  "curated tracks use local public paths"
);
assert(
  curated.every((t) => t.commercialUseAllowed),
  "curated tracks marked commercial-safe"
);

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
