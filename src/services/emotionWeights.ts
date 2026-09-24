/**
 * Emotion Fusion Weights & Types
 * Configurable weight system and helper mappings for the fusion engine.
 */

// ── Interfaces ─────────────────────────────────────────────────

export interface FusionInput {
  textEmotion?: string;
  textScore?: number;
  faceScore?: number;
  faceMood?: string;
  historyScore?: number;
  voiceScore?: number;
}

export interface FusionResult {
  score: number;
  mood: string;
  confidence: number;
  sources: string[];
  mismatch: boolean;
  explanation: string;
}

// ── Weights ────────────────────────────────────────────────────

export const FUSION_WEIGHTS = {
  text: 0.50,
  face: 0.25,
  voice: 0.15,
  history: 0.10,
};

// ── Text Emotion → Score ───────────────────────────────────────

const TEXT_EMOTION_MAP: Record<string, number> = {
  panic: 10,
  stress: 25,
  low: 30,
  neutral: 50,
  positive: 75,
};

export function textEmotionToScore(emotion: string): number {
  return TEXT_EMOTION_MAP[emotion] ?? 50;
}

// ── Score → Mood Label ─────────────────────────────────────────

export function moodLabelFromScore(score: number): string {
  if (score <= 20) return "Down";
  if (score <= 40) return "Uneasy";
  if (score <= 60) return "Neutral";
  if (score <= 80) return "Happy";
  return "Excited";
}
