/**
 * Emotion Fusion Service
 * Pure calculation layer — no DB, no API, no LLM, no side effects.
 * Combines available emotional signals into a single unified result.
 */

import {
  FusionInput,
  FusionResult,
  FUSION_WEIGHTS,
  textEmotionToScore,
  moodLabelFromScore,
} from "./emotionWeights";

const MISMATCH_THRESHOLD = 25;

function isValidScore(value: unknown): value is number {
  return typeof value === "number" && !Number.isNaN(value) && isFinite(value);
}

export function fuseEmotion(input: FusionInput): FusionResult {
  const sources: { key: string; score: number; weight: number }[] = [];
  const sourceLabels: string[] = [];

  // Resolve text score
  let textScore: number | undefined;
  if (isValidScore(input.textScore)) {
    textScore = input.textScore;
  } else if (input.textEmotion) {
    textScore = textEmotionToScore(input.textEmotion);
  }
  if (textScore !== undefined && isValidScore(textScore)) {
    sources.push({ key: "text", score: textScore, weight: FUSION_WEIGHTS.text });
    sourceLabels.push("text");
  }

  if (isValidScore(input.faceScore)) {
    sources.push({ key: "face", score: input.faceScore, weight: FUSION_WEIGHTS.face });
    sourceLabels.push("face");
  }

  if (isValidScore(input.voiceScore)) {
    sources.push({ key: "voice", score: input.voiceScore, weight: FUSION_WEIGHTS.voice });
    sourceLabels.push("voice");
  }

  if (isValidScore(input.historyScore)) {
    sources.push({ key: "history", score: input.historyScore, weight: FUSION_WEIGHTS.history });
    sourceLabels.push("history");
  }

  // Nothing to fuse — return safe neutral fallback
  if (sources.length === 0) {
    return {
      score: 50,
      mood: "Neutral",
      confidence: 0.5,
      sources: [],
      mismatch: false,
      explanation: "No emotional signals available",
    };
  }

  // Normalize weights so available sources sum to 1.0
  const totalWeight = sources.reduce((sum, s) => sum + s.weight, 0);
  const normalizedSources = sources.map(s => ({
    ...s,
    normalizedWeight: s.weight / totalWeight,
  }));

  // Weighted score — guard against NaN
  const rawFinalScore = normalizedSources.reduce((sum, s) => sum + s.score * s.normalizedWeight, 0);
  const finalScore = isValidScore(rawFinalScore) ? Math.round(rawFinalScore) : 50;

  // Mismatch detection (text vs face)
  let mismatch = false;
  if (isValidScore(textScore) && isValidScore(input.faceScore)) {
    const diff = Math.abs(textScore - input.faceScore);
    if (diff > MISMATCH_THRESHOLD) {
      mismatch = true;
    }
  }

  // Confidence: based on agreement between available sources
  let confidence: number;
  if (sources.length === 1) {
    confidence = 0.75;
  } else {
    const scores = sources.map(s => s.score);
    const maxDiff = Math.max(...scores) - Math.min(...scores);
    const rawConfidence = 0.95 - (maxDiff / 100) * 0.55;
    confidence = isValidScore(rawConfidence)
      ? Math.round(Math.max(0.4, Math.min(0.95, rawConfidence)) * 100) / 100
      : 0.6;
  }

  const explanation = mismatch
    ? "Text and other emotional signals show some difference. Prioritize the user's own words while maintaining a supportive tone."
    : "Emotional signals are consistent.";

  return {
    score: Math.max(0, Math.min(100, finalScore)),
    mood: moodLabelFromScore(finalScore),
    confidence,
    sources: sourceLabels,
    mismatch,
    explanation,
  };
}

/**
 * Builds a concise guidance string for LLM injection.
 * Outputs descriptive human-readable guidance — no raw scores, no analytics.
 */
export function buildFusionContext(result: FusionResult, _input: FusionInput): string {
  const lines: string[] = ["[Emotional Guidance]"];
  lines.push(`The user's current emotional state appears to be ${result.mood}.`);

  if (result.mismatch) {
    lines.push(result.explanation);
  } else if (result.confidence >= 0.8) {
    lines.push("Emotional signals are consistent. Respond naturally.");
  }

  return lines.join("\n");
}
