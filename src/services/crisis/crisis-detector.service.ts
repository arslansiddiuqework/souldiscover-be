/**
 * Crisis Detector Service
 * ───────────────────────
 * Consumes EmotionAIResult (from existing pipeline) and produces
 * a CrisisAssessment. NEVER calls Groq directly — relies on the
 * already-resolved emotion analysis.
 */

import { EmotionAIResult } from "../emotionAI.service";
import { CrisisAssessment } from "./crisis-types";
import {
  CRISIS_KEYWORDS,
  SCORE_WEIGHTS,
  classifyRiskLevel,
  MIN_CONFIDENCE_FOR_ESCALATION,
  SUICIDE_RISK_IMMEDIATE_THRESHOLD,
  SELF_HARM_IMMEDIATE_THRESHOLD,
} from "./risk-thresholds";
import { logger } from "../../utils/logger";

// ── Keyword Risk Scorer ────────────────────────────────────────────────────────
function keywordRisk(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  const matches = keywords.filter((kw) => lower.includes(kw)).length;
  if (matches === 0) return 0;
  // Diminishing returns: 1 match → 0.6, 2 → 0.8, 3+ → 1.0
  return Math.min(0.4 + matches * 0.2, 1.0);
}

// ── Main Assessment ────────────────────────────────────────────────────────────
export function assessCrisisRisk(
  emotionResult: EmotionAIResult,
  userMessage: string
): CrisisAssessment {
  // Prefer AI-provided scores; fall back to keyword detection
  const suicideRisk =
    typeof emotionResult.suicideRisk === "number"
      ? emotionResult.suicideRisk
      : keywordRisk(userMessage, CRISIS_KEYWORDS.suicide);

  const selfHarmRisk =
    typeof emotionResult.selfHarmRisk === "number"
      ? emotionResult.selfHarmRisk
      : keywordRisk(userMessage, CRISIS_KEYWORDS.selfHarm);

  const panicSeverity =
    typeof emotionResult.panicSeverity === "number"
      ? emotionResult.panicSeverity
      : emotionResult.emotion === "panic"
        ? emotionResult.intensity
        : keywordRisk(userMessage, CRISIS_KEYWORDS.severePanic);

  const hopelessnessScore = keywordRisk(userMessage, CRISIS_KEYWORDS.hopelessness);

  // Compute composite score
  let crisisRiskScore =
    typeof emotionResult.crisisRiskScore === "number"
      ? emotionResult.crisisRiskScore
      : suicideRisk   * SCORE_WEIGHTS.suicideKeyword +
        selfHarmRisk  * SCORE_WEIGHTS.selfHarmKeyword +
        panicSeverity * SCORE_WEIGHTS.panicKeyword +
        hopelessnessScore * SCORE_WEIGHTS.hopelessnessKeyword +
        (emotionResult.intensity > 0.8 ? SCORE_WEIGHTS.highIntensityBoost : 0);

  // Override: individual high risks push composite up
  if (suicideRisk  >= SUICIDE_RISK_IMMEDIATE_THRESHOLD)  crisisRiskScore = Math.max(crisisRiskScore, 0.90);
  if (selfHarmRisk >= SELF_HARM_IMMEDIATE_THRESHOLD) crisisRiskScore = Math.max(crisisRiskScore, 0.80);

  crisisRiskScore = Math.min(Math.max(crisisRiskScore, 0), 1); // clamp

  const riskLevel = classifyRiskLevel(crisisRiskScore);

  // Confidence: signal strength determines how certain we are
  const signalStrength = suicideRisk + selfHarmRisk + panicSeverity * 0.5 + hopelessnessScore * 0.3;
  const confidence = Math.min(signalStrength / 1.5, 1.0);

  const escalationRecommended =
    (riskLevel === "HIGH" || riskLevel === "CRITICAL") &&
    confidence >= MIN_CONFIDENCE_FOR_ESCALATION;

  // Build reason string
  let escalationReason: string | undefined;
  let recommendedAction: string | undefined;

  if (escalationRecommended) {
    const reasons: string[] = [];
    if (suicideRisk  >= 0.4) reasons.push("suicidal ideation detected");
    if (selfHarmRisk >= 0.4) reasons.push("self-harm risk detected");
    if (panicSeverity >= 0.7) reasons.push("severe panic episode");
    if (hopelessnessScore >= 0.5) reasons.push("prolonged hopelessness");
    escalationReason = reasons.length
      ? reasons.join("; ")
      : (emotionResult.escalationReason || "high emotional distress");

    recommendedAction =
      riskLevel === "CRITICAL"
        ? "Immediate contact recommended — please reach out to this person right away"
        : "Please check in on this person and offer your support";
  }

  logger.info("[CRISIS_ASSESSMENT]", {
    riskLevel,
    score: crisisRiskScore.toFixed(3),
    escalationRecommended,
    reason: escalationReason || "None"
  });

  return {
    riskLevel,
    crisisRiskScore,
    suicideRisk,
    selfHarmRisk,
    panicSeverity,
    escalationRecommended,
    escalationReason,
    recommendedAction,
    confidence,
  };
}
