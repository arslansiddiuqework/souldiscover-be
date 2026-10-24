/**
 * Lightweight scoring engine tests — run with: npx ts-node src/__tests__/assessment-scoring.test.ts
 */

import { getAssessmentBySlug } from "../assessments/catalog";
import {
  getVisibleQuestionIds,
  scoreAssessment,
  validateAnswers,
} from "../assessments/scoring/engine";
import { AnswerPayload } from "../assessments/types";

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

function answersFrom(
  map: Record<string, number | string | null>,
  skipped: string[] = []
): AnswerPayload[] {
  return Object.entries(map).map(([questionId, value]) => ({
    questionId,
    value,
    skipped: skipped.includes(questionId) || value === null,
  }));
}

console.log("\nAssessment scoring engine tests\n");

const daily = getAssessmentBySlug("daily-wellbeing-reflection");
assert(Boolean(daily), "loads daily wellbeing definition");
assert(daily?.version === "1.0.0", "daily wellbeing version is 1.0.0");
assert(daily?.clinicallyValidated === false, "daily wellbeing is not clinically validated");
assert(daily?.questions.length === 8, "daily wellbeing has 8 questions");

if (daily) {
  const balanced = answersFrom({
    mood: 3,
    stress: 1,
    rest: 3,
    energy: 3,
    focus: 3,
    connection: 3,
    self_kindness: 3,
    daily_functioning: 1,
  });
  const balancedResult = scoreAssessment(daily, balanced);
  assert(balancedResult.totalScore === null, "reflection does not invent a clinical total score");
  assert(balancedResult.clinicallyValidated === false, "result marks non-clinical");
  assert(balancedResult.instrumentVersion === "1.0.0", "stores instrument version");
  assert(balancedResult.goingWell.length > 0, "detects going-well domains");
  assert(balancedResult.suggestedPlanSlugs.length > 0, "suggests wellness plans");
  assert(
    balancedResult.disclaimer.toLowerCase().includes("not been clinically validated"),
    "includes non-clinical disclaimer"
  );

  const stressed = answersFrom({
    mood: 1,
    stress: 4,
    rest: 1,
    energy: 1,
    focus: 1,
    connection: 1,
    self_kindness: 1,
    daily_functioning: 4,
  });
  const stressedResult = scoreAssessment(daily, stressed);
  assert(stressedResult.needsAttention.length > 0, "flags attention domains under stress");
  assert(
    stressedResult.suggestedPlanSlugs.includes("stress-burnout") ||
      stressedResult.suggestedPlanSlugs.includes("reduce-anxiety") ||
      stressedResult.suggestedPlanSlugs.includes("emotional-balance"),
    "maps attention domains to known plan slugs"
  );
  assert(Boolean(stressedResult.smallStep), "provides a small step");

  const skipped = answersFrom(
    {
      mood: null,
      stress: null,
      rest: null,
      energy: null,
      focus: null,
      connection: null,
      self_kindness: null,
      daily_functioning: null,
    },
    [
      "mood",
      "stress",
      "rest",
      "energy",
      "focus",
      "connection",
      "self_kindness",
      "daily_functioning",
    ]
  );
  const skippedResult = scoreAssessment(daily, skipped);
  assert(skippedResult.answeredCount === 0, "handles all skipped answers");
  assert(skippedResult.skippedCount === 8, "counts skipped questions");

  const invalid = validateAnswers(daily, [
    { questionId: "mood", value: 99 },
  ]);
  assert(invalid.ok === false, "rejects invalid answer values");

  const unknown = validateAnswers(daily, [
    { questionId: "not-a-question", value: 1 },
  ]);
  assert(unknown.ok === false, "rejects unknown question ids");

  const visible = getVisibleQuestionIds(daily, balanced);
  assert(visible.length === 8, "progress counts all visible questions without branching");
}

const comingSoon = getAssessmentBySlug("depression-symptoms-screening");
assert(comingSoon?.status === "coming_soon", "PHQ-9 candidate remains coming soon");
assert((comingSoon?.questions.length || 0) === 0, "coming soon has no startable questions");

const stress = getAssessmentBySlug("stress-check-in");
assert(stress?.status === "published", "stress check-in is published");
if (stress) {
  try {
    scoreAssessment(stress, [{ questionId: "pressure", value: 9 }]);
    assert(false, "invalid stress value throws");
  } catch {
    assert(true, "invalid stress value throws");
  }
}

const finder = getAssessmentBySlug("starting-point-finder");
assert(Boolean(finder), "starting point finder exists");
if (finder) {
  const routed = scoreAssessment(finder, [
    { questionId: "explore", value: "sleep" },
    { questionId: "hope", value: "practical" },
  ]);
  assert(
    (routed.suggestedAssessmentSlugs || []).includes("sleep-rest-check-in"),
    "routes sleep concern to sleep check-in"
  );
  assert(
    (routed.educationalTips || []).length > 0,
    "returns educational tips without clinical risk score"
  );
  assert(routed.totalScore === null, "finder does not invent a clinical score");

  const stressedRoute = scoreAssessment(finder, [
    { questionId: "explore", value: "stressed" },
    { questionId: "hope", value: "practical" },
  ]);
  assert(
    (stressedRoute.suggestedAssessmentSlugs || []).includes("anger-management"),
    "routes stressed explore to anger-management reflection"
  );
}

const anger = getAssessmentBySlug("anger-management");
assert(Boolean(anger), "loads anger-management definition");
assert(anger?.status === "published", "anger-management is published");
assert(anger?.clinicallyValidated === false, "anger-management is not clinically validated");
assert(anger?.version === "1.0.0", "anger-management version is 1.0.0");
assert(anger?.questions.length === 8, "anger-management has 8 questions");
assert(anger?.scoringMethod === "reflection_domains", "anger uses reflection_domains");

if (anger) {
  const elevated = answersFrom({
    frequency_intensity: 4,
    triggers: 1,
    body_signals: 1,
    impulsive_reactions: 4,
    recovery_time: 1,
    communication: 1,
    consequences: 4,
    coping_strategies: 1,
  });
  const elevatedResult = scoreAssessment(anger, elevated);
  assert(elevatedResult.totalScore === null, "anger reflection has no clinical total");
  assert(elevatedResult.needsAttention.length > 0, "flags attention domains for elevated anger");
  assert(
    elevatedResult.suggestedPlanSlugs.includes("anger-frustration"),
    "suggests anger-frustration wellness plan"
  );
  assert(
    elevatedResult.disclaimer.toLowerCase().includes("not been clinically validated"),
    "includes non-clinical disclaimer"
  );

  const steadier = answersFrom({
    frequency_intensity: 1,
    triggers: 3,
    body_signals: 3,
    impulsive_reactions: 1,
    recovery_time: 3,
    communication: 3,
    consequences: 1,
    coping_strategies: 3,
  });
  const steadierResult = scoreAssessment(anger, steadier);
  assert(steadierResult.goingWell.length > 0, "detects going-well anger domains");

  try {
    scoreAssessment(anger, [{ questionId: "frequency_intensity", value: 99 }]);
    assert(false, "invalid anger value throws");
  } catch {
    assert(true, "invalid anger value throws");
  }

  const unknownAnger = validateAnswers(anger, [
    { questionId: "not-a-question", value: 1 },
  ]);
  assert(unknownAnger.ok === false, "rejects unknown anger question ids");
}

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
