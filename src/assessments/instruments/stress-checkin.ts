import { AssessmentDefinition } from "../types";

const OPTIONS = [
  { id: "never", label: "Never", value: 0 },
  { id: "rarely", label: "Rarely", value: 1 },
  { id: "sometimes", label: "Sometimes", value: 2 },
  { id: "often", label: "Often", value: 3 },
  { id: "almost_always", label: "Almost always", value: 4 },
];

/** Original Soul Discovery non-diagnostic stress check-in. */
export const stressCheckIn: AssessmentDefinition = {
  id: "stress-check-in",
  slug: "stress-check-in",
  version: "1.0.0",
  title: "Stress Check-In",
  shortDescription:
    "Reflect on your current stress, its possible sources, and how it affects your day.",
  longDescription:
    "A short, non-diagnostic Soul Discovery check-in to notice stress patterns and choose a supportive next step. This is not a clinical stress disorder assessment.",
  category: "focus_functioning",
  typeBadge: "check_in",
  estimatedMinutes: 4,
  audience: "Adults (18+)",
  ageMin: 18,
  referencePeriod: "Over the past seven days.",
  privacyNote: "Your answers are personal and optional to save.",
  status: "published",
  clinicallyValidated: false,
  requiresAcknowledgment: true,
  questionCount: 5,
  questions: [
    {
      id: "pressure",
      text: "How often have you felt under pressure from your responsibilities?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "stress",
    },
    {
      id: "tension",
      text: "How often have you noticed physical tension (tight shoulders, jaw, or stomach) related to stress?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "stress",
    },
    {
      id: "recovery",
      text: "How often have you been able to unwind or recover after a stressful moment?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "rest",
    },
    {
      id: "irritability",
      text: "How often has stress made it harder to be patient with yourself or others?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "daily_functioning",
    },
    {
      id: "coping",
      text: "How often have you used a helpful coping strategy when you felt stressed?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "self_kindness",
    },
  ],
  scoringMethod: "reflection_domains",
  reflectionDomains: [
    {
      domain: "stress",
      questionIds: ["pressure", "tension"],
      polarity: "challenge",
      attentionThreshold: 2.5,
      goingWellThreshold: 1.5,
    },
    {
      domain: "rest",
      questionIds: ["recovery"],
      polarity: "positive",
      attentionThreshold: 1.5,
      goingWellThreshold: 2.5,
    },
    {
      domain: "daily_functioning",
      questionIds: ["irritability"],
      polarity: "challenge",
      attentionThreshold: 2.5,
      goingWellThreshold: 1.5,
    },
    {
      domain: "self_kindness",
      questionIds: ["coping"],
      polarity: "positive",
      attentionThreshold: 1.5,
      goingWellThreshold: 2.5,
    },
  ],
  license: {
    source: "Soul Discovery — original stress check-in",
    license: "Proprietary original content; not a clinical instrument",
    clinicallyValidated: false,
    notes: "Clearly labeled non-diagnostic Soul Discovery check-in.",
  },
  whatItExplores: [
    "Felt pressure and physical tension",
    "Ability to recover after stress",
    "Impact on patience and daily interactions",
    "Use of helpful coping strategies",
  ],
  whatHappensAfter: [
    "You receive a descriptive reflection — not a diagnosis.",
    "You can explore free stress-support activities in your Wellness Plan.",
  ],
  recommendations: [
    {
      planSlug: "stress-burnout",
      reason: "Practical steps when pressure and fatigue build up.",
      domains: ["stress", "daily_functioning"],
    },
    {
      planSlug: "reduce-anxiety",
      reason: "Calming tools when stress shows up as worry or tension.",
      domains: ["stress"],
    },
    {
      planSlug: "emotional-balance",
      reason: "Steady practices when stress spills into daily interactions.",
      domains: ["daily_functioning"],
    },
  ],
  primaryNextStep: {
    label: "Explore stress support activities",
    href: "/wellness-plan?plan=stress-burnout",
  },
  effectiveDate: "2026-03-26",
  icon: "wind",
};
