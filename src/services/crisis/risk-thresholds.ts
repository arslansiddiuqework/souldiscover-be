// ── Risk Threshold Configuration ───────────────────────────────────────────────
// All values are driven from environment variables with safe defaults.

import { RiskLevel } from "./crisis-types";

// ── Risk Level Boundaries ─────────────────────────────────────────────────────
export const RISK_THRESHOLDS = {
  HIGH:     parseFloat(process.env.CRISIS_HIGH_THRESHOLD     || "0.75"),
  CRITICAL: parseFloat(process.env.CRISIS_CRITICAL_THRESHOLD || "0.90"),
};

// ── Confidence Gate ───────────────────────────────────────────────────────────
// Never escalate if our confidence is too low (prevents false positives)
export const MIN_CONFIDENCE_FOR_ESCALATION = 0.55;

// ── Immediate Escalation Overrides ────────────────────────────────────────────
// If these individual risks are very high, we escalate regardless of composite
export const SUICIDE_RISK_IMMEDIATE_THRESHOLD   = 0.70;
export const SELF_HARM_IMMEDIATE_THRESHOLD      = 0.75;

// ── Keyword Lists ─────────────────────────────────────────────────────────────
export const CRISIS_KEYWORDS = {
  suicide: [
    "kill myself", "end my life", "want to die", "don't want to live",
    "suicide", "suicidal", "not want to live", "better off dead",
    "take my own life", "end it all", "don't want to exist",
    "wish i was dead", "no point living",
  ],
  selfHarm: [
    "hurt myself", "harm myself", "cut myself", "self-harm", "self harm",
    "injure myself", "punish myself", "deserve pain", "cutting",
  ],
  severePanic: [
    "can't breathe", "heart attack", "i'm dying", "can't cope",
    "breaking down", "losing my mind", "complete breakdown",
    "can't take it anymore", "falling apart",
  ],
  hopelessness: [
    "hopeless", "no hope", "nothing to live for", "pointless",
    "no future", "won't get better", "never going to be okay",
    "completely alone", "nobody cares", "no one cares",
  ],
};

// ── Score Weights ─────────────────────────────────────────────────────────────
export const SCORE_WEIGHTS = {
  suicideKeyword:    0.45,
  selfHarmKeyword:   0.30,
  panicKeyword:      0.15,
  hopelessnessKeyword: 0.15,
  highIntensityBoost:  0.10,
};

// ── Risk Level Classifier ─────────────────────────────────────────────────────
export function classifyRiskLevel(score: number): RiskLevel {
  if (score >= RISK_THRESHOLDS.CRITICAL) return "CRITICAL";
  if (score >= RISK_THRESHOLDS.HIGH)     return "HIGH";
  if (score >= 0.40)                     return "MEDIUM";
  return "LOW";
}
