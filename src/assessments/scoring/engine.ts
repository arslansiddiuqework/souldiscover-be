import {
  AnswerPayload,
  AssessmentDefinition,
  AssessmentQuestion,
  ScoringResult,
} from "../types";
import { suggestFromStartingPoint } from "../instruments/starting-point";

const DOMAIN_LABELS: Record<string, string> = {
  mood: "mood and emotional balance",
  stress: "stress and overwhelm",
  rest: "rest and sleep",
  rest_difficulty: "falling asleep",
  energy: "energy",
  focus: "focus",
  connection: "feeling connected",
  self_kindness: "self-kindness",
  daily_functioning: "everyday functioning",
  anger_intensity: "anger intensity and frequency",
  anger_triggers: "noticing anger triggers",
  anger_body: "body warning signs",
  anger_impulse: "pausing before reacting",
  anger_recovery: "settling after anger",
  anger_communication: "clear, respectful communication",
  anger_consequences: "impact of angry reactions",
  anger_coping: "helpful coping strategies",
};

const SMALL_STEPS: Record<string, string> = {
  mood: "Take two quiet minutes to name one feeling without judging it.",
  stress: "Pause for three slow breaths before your next task.",
  rest: "Choose a gentle wind-down cue for tonight, such as dimming lights earlier.",
  rest_difficulty: "Write down one worry on paper so it does not need to stay in your head.",
  energy: "Plan one small restorative break today, even five minutes.",
  focus: "Pick one task and work on it for just ten focused minutes.",
  connection: "Send a brief message to someone you trust.",
  self_kindness: "Speak to yourself as you would to a friend who is struggling.",
  daily_functioning: "Break one hard task into a smaller first step you can finish today.",
  anger_intensity:
    "When frustration rises, name it quietly: “I feel angry” — without acting on it yet.",
  anger_triggers:
    "Write down one situation that often sparks anger so you can spot it earlier next time.",
  anger_body:
    "Scan your body once today for heat, jaw tension, or a racing heart when frustration builds.",
  anger_impulse:
    "Practice a 10-second pause before you reply the next time tone starts to rise.",
  anger_recovery:
    "After a heated moment, take three breaths with a slightly longer exhale to settle.",
  anger_communication:
    "Try one “I feel… when… I need…” sentence instead of blaming language.",
  anger_consequences:
    "If something was said in anger, plan one small repair step when you feel calmer.",
  anger_coping:
    "Pick one coping tool (pause, time-out, or journaling) and use it once this week.",
};

function asNumber(value: number | string | Array<number | string> | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function answerMap(answers: AnswerPayload[]): Map<string, AnswerPayload> {
  const map = new Map<string, AnswerPayload>();
  for (const a of answers) {
    if (a?.questionId) map.set(a.questionId, a);
  }
  return map;
}

function isQuestionVisible(
  question: AssessmentQuestion,
  answers: Map<string, AnswerPayload>
): boolean {
  if (!question.showIf) return true;
  const prior = answers.get(question.showIf.questionId);
  if (!prior || prior.skipped || prior.value === null || prior.value === undefined) {
    return false;
  }
  const values = Array.isArray(prior.value) ? prior.value : [prior.value];
  return values.some((v) => question.showIf!.values.includes(v));
}

export function validateAnswers(
  def: AssessmentDefinition,
  answers: AnswerPayload[]
): { ok: true } | { ok: false; message: string } {
  if (!Array.isArray(answers)) {
    return { ok: false, message: "Answers must be an array" };
  }

  const map = answerMap(answers);
  const knownIds = new Set(def.questions.map((q) => q.id));

  for (const a of answers) {
    if (!knownIds.has(a.questionId)) {
      return { ok: false, message: `Unknown question: ${a.questionId}` };
    }
  }

  for (const q of def.questions) {
    if (!isQuestionVisible(q, map)) continue;
    const a = map.get(q.id);

    if (!a || a.skipped || a.value === null || a.value === undefined) {
      if (q.required && !q.allowSkip) {
        return { ok: false, message: `Question "${q.id}" is required` };
      }
      continue;
    }

    const allowed = new Set(q.options.map((o) => String(o.value)));
    const values = Array.isArray(a.value) ? a.value : [a.value];

    if (q.responseType === "single" && values.length !== 1) {
      return { ok: false, message: `Question "${q.id}" expects a single answer` };
    }

    for (const v of values) {
      if (!allowed.has(String(v))) {
        return { ok: false, message: `Invalid answer value for question "${q.id}"` };
      }
    }
  }

  return { ok: true };
}

function scoreReflectionDomains(
  def: AssessmentDefinition,
  answers: AnswerPayload[]
): ScoringResult {
  const map = answerMap(answers);
  let answeredCount = 0;
  let skippedCount = 0;

  for (const q of def.questions) {
    if (!isQuestionVisible(q, map)) continue;
    const a = map.get(q.id);
    if (!a || a.skipped || a.value === null || a.value === undefined) {
      skippedCount += 1;
    } else {
      answeredCount += 1;
    }
  }

  const domains: ScoringResult["domains"] = [];
  const goingWell: string[] = [];
  const needsAttention: string[] = [];
  const planSlugs = new Set<string>();

  for (const rule of def.reflectionDomains || []) {
    const nums: number[] = [];
    for (const qid of rule.questionIds) {
      const a = map.get(qid);
      if (!a || a.skipped) continue;
      const n = asNumber(a.value as number | string | null);
      if (n !== null) nums.push(n);
    }

    if (nums.length === 0) {
      domains.push({
        domain: rule.domain,
        average: null,
        status: "skipped",
        note: "You skipped this area.",
      });
      continue;
    }

    const average = nums.reduce((s, n) => s + n, 0) / nums.length;
    let status: "going_well" | "attention" | "neutral" = "neutral";

    if (rule.polarity === "positive") {
      if (average >= rule.goingWellThreshold) status = "going_well";
      else if (average <= rule.attentionThreshold) status = "attention";
    } else {
      if (average <= rule.goingWellThreshold) status = "going_well";
      else if (average >= rule.attentionThreshold) status = "attention";
    }

    const label = DOMAIN_LABELS[rule.domain] || rule.domain;
    let note = `You reflected on ${label}.`;
    if (status === "going_well") {
      note = `${label.charAt(0).toUpperCase() + label.slice(1)} seems to be an area of relative strength right now.`;
      goingWell.push(label);
    } else if (status === "attention") {
      note = `${label.charAt(0).toUpperCase() + label.slice(1)} may deserve a little extra care.`;
      needsAttention.push(label);
    }

    domains.push({ domain: rule.domain, average, status, note });

    if (status === "attention") {
      for (const rec of def.recommendations) {
        if (!rec.domains || rec.domains.includes(rule.domain)) {
          planSlugs.add(rec.planSlug);
        }
      }
    }
  }

  if (planSlugs.size === 0) {
    for (const rec of def.recommendations.slice(0, 2)) {
      planSlugs.add(rec.planSlug);
    }
  }

  const attentionDomain = needsAttention[0]
    ? Object.entries(DOMAIN_LABELS).find(([, v]) => v === needsAttention[0])?.[0]
    : undefined;
  const smallStep =
    (attentionDomain && SMALL_STEPS[attentionDomain]) ||
    "Take a short walk or stretch, then notice one thing that felt even slightly better.";

  const interpretationSummary =
    answeredCount === 0
      ? "You skipped the reflection questions. You can retake this anytime when you feel ready."
      : needsAttention.length > 0
        ? `You noticed a few areas that may need attention: ${needsAttention.join(", ")}. These are patterns to explore — not a diagnosis.`
        : goingWell.length > 0
          ? `Several areas look relatively steady right now, including ${goingWell.join(", ")}. Keep tending to what helps.`
          : "Your answers suggest a mixed picture. Exploring one small supportive activity can be a kind next step.";

  return {
    instrumentId: def.id,
    instrumentVersion: def.version,
    scoringMethod: "reflection_domains",
    clinicallyValidated: false,
    totalScore: null,
    maxScore: null,
    interpretationLabel: null,
    interpretationSummary,
    domains,
    goingWell,
    needsAttention,
    smallStep,
    suggestedPlanSlugs: Array.from(planSlugs).slice(0, 4),
    disclaimer:
      "This is an original Soul Discovery wellness reflection. It has not been clinically validated and is not a diagnosis.",
    answeredCount,
    skippedCount,
  };
}

function scoreStartingPoint(
  def: AssessmentDefinition,
  answers: AnswerPayload[]
): ScoringResult {
  const map = answerMap(answers);
  const explore = String(map.get("explore")?.value ?? "unsure");
  const hope = String(map.get("hope")?.value ?? "feelings");
  const suggestion = suggestFromStartingPoint(explore, hope);

  return {
    instrumentId: def.id,
    instrumentVersion: def.version,
    scoringMethod: "starting_point_routing",
    clinicallyValidated: false,
    totalScore: null,
    maxScore: null,
    interpretationLabel: "Suggested starting points",
    interpretationSummary: suggestion.reason,
    domains: [],
    goingWell: [],
    needsAttention: [],
    smallStep: suggestion.educationalTips[0] || "Browse the Assessment Center at your own pace.",
    suggestedPlanSlugs: [],
    suggestedAssessmentSlugs: suggestion.assessmentSlugs,
    educationalTips: suggestion.educationalTips,
    disclaimer:
      "These suggestions are for navigation only. They are not a diagnosis or clinical risk score.",
    answeredCount: answers.filter((a) => !a.skipped && a.value != null).length,
    skippedCount: answers.filter((a) => a.skipped).length,
  };
}

/**
 * Deterministic scoring engine. Never invents clinical cutoffs.
 * Never uses an LLM. Instrument version is returned with every result.
 */
export function scoreAssessment(
  def: AssessmentDefinition,
  answers: AnswerPayload[]
): ScoringResult {
  const validation = validateAnswers(def, answers);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  if (def.status !== "published") {
    throw new Error("This assessment is not available");
  }

  switch (def.scoringMethod) {
    case "reflection_domains":
      return scoreReflectionDomains(def, answers);
    case "starting_point_routing":
      return scoreStartingPoint(def, answers);
    case "none":
      throw new Error("This assessment has no scoring method configured");
    case "sum":
      throw new Error(
        "Sum scoring is reserved for verified clinical instruments and is not enabled for this definition"
      );
    default:
      throw new Error("Unsupported scoring method");
  }
}

export function getVisibleQuestionIds(
  def: AssessmentDefinition,
  answers: AnswerPayload[]
): string[] {
  const map = answerMap(answers);
  return def.questions.filter((q) => isQuestionVisible(q, map)).map((q) => q.id);
}

export { DOMAIN_LABELS, SMALL_STEPS };
