import { AssessmentDefinition } from "../types";

/** Frequency / intensity scale for the past two weeks (0–4). */
const OPTIONS = [
  { id: "never", label: "Never / not at all", value: 0 },
  { id: "rarely", label: "Rarely", value: 1 },
  { id: "sometimes", label: "Sometimes", value: 2 },
  { id: "often", label: "Often", value: 3 },
  { id: "almost_always", label: "Almost always", value: 4 },
];

/**
 * Original Soul Discovery non-diagnostic anger self-reflection.
 * Not a clinical anger disorder instrument; no diagnostic cutoffs.
 */
export const angerManagementReflection: AssessmentDefinition = {
  id: "anger-management",
  slug: "anger-management",
  version: "1.0.0",
  title: "Anger Management Reflection",
  shortDescription:
    "Notice how anger shows up — triggers, body signals, reactions, and what helps you recover.",
  longDescription:
    "A short, original Soul Discovery self-reflection about anger and frustration over the past two weeks. Anger is a normal emotion; this check-in helps you understand patterns and choose healthier responses. It is not a diagnosis, not a clinical anger assessment, and not a substitute for therapy or emergency care.",
  category: "emotional_wellbeing",
  typeBadge: "self_reflection",
  estimatedMinutes: 6,
  audience: "Adults (18+)",
  ageMin: 18,
  referencePeriod: "Over the past two weeks.",
  privacyNote:
    "Your answers are personal. Saving results is optional and stays with your account.",
  status: "published",
  clinicallyValidated: false,
  requiresAcknowledgment: true,
  questionCount: 8,
  questions: [
    {
      id: "frequency_intensity",
      text: "How often have you felt angry or frustrated at a level that was hard to shake off?",
      helpText: "Think about both how often it showed up and how strong it felt.",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "anger_intensity",
    },
    {
      id: "triggers",
      text: "How often could you spot a clear trigger (person, situation, or thought) before anger rose?",
      helpText: "Noticing triggers early is a skill — there is no wrong answer.",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "anger_triggers",
    },
    {
      id: "body_signals",
      text: "How often have you noticed physical warning signs (heat, tight jaw, racing heart, clenched fists) when frustration built?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "anger_body",
    },
    {
      id: "impulsive_reactions",
      text: "How often have you reacted quickly (words, tone, or actions) before you had a chance to pause?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "anger_impulse",
    },
    {
      id: "recovery_time",
      text: "How often have you been able to settle your body and emotions within a short time after anger peaked?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "anger_recovery",
    },
    {
      id: "communication",
      text: "How often have you expressed needs or boundaries in a clear, respectful way during conflict?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "anger_communication",
    },
    {
      id: "consequences",
      text: "How often has anger led to outcomes you later regretted (hurt feelings, strained trust, or trouble at work/home)?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "anger_consequences",
    },
    {
      id: "coping_strategies",
      text: "How often have you used a helpful coping strategy (pause, breathing, time-out, journaling) when anger rose?",
      required: false,
      allowSkip: true,
      responseType: "single",
      options: OPTIONS,
      domain: "anger_coping",
    },
  ],
  scoringMethod: "reflection_domains",
  reflectionDomains: [
    {
      domain: "anger_intensity",
      questionIds: ["frequency_intensity"],
      polarity: "challenge",
      attentionThreshold: 2.5,
      goingWellThreshold: 1.5,
    },
    {
      domain: "anger_triggers",
      questionIds: ["triggers"],
      polarity: "positive",
      attentionThreshold: 1.5,
      goingWellThreshold: 2.5,
    },
    {
      domain: "anger_body",
      questionIds: ["body_signals"],
      polarity: "positive",
      attentionThreshold: 1.5,
      goingWellThreshold: 2.5,
    },
    {
      domain: "anger_impulse",
      questionIds: ["impulsive_reactions"],
      polarity: "challenge",
      attentionThreshold: 2.5,
      goingWellThreshold: 1.5,
    },
    {
      domain: "anger_recovery",
      questionIds: ["recovery_time"],
      polarity: "positive",
      attentionThreshold: 1.5,
      goingWellThreshold: 2.5,
    },
    {
      domain: "anger_communication",
      questionIds: ["communication"],
      polarity: "positive",
      attentionThreshold: 1.5,
      goingWellThreshold: 2.5,
    },
    {
      domain: "anger_consequences",
      questionIds: ["consequences"],
      polarity: "challenge",
      attentionThreshold: 2.5,
      goingWellThreshold: 1.5,
    },
    {
      domain: "anger_coping",
      questionIds: ["coping_strategies"],
      polarity: "positive",
      attentionThreshold: 1.5,
      goingWellThreshold: 2.5,
    },
  ],
  license: {
    source: "Soul Discovery — original anger management reflection",
    license: "Proprietary original content; not a clinical instrument",
    clinicallyValidated: false,
    notes:
      "Non-diagnostic self-reflection. Does not diagnose anger disorders or claim clinical validity. Soul Discovery is not an emergency service.",
  },
  whatItExplores: [
    "How often and how strongly anger shows up",
    "Triggers and physical warning signs",
    "Impulsive reactions vs. pausing",
    "Recovery time, communication, and coping",
    "Whether anger has led to regretted consequences",
  ],
  whatHappensAfter: [
    "You receive a descriptive reflection — not a diagnosis or clinical score.",
    "You can preview free Anger Management activities and choose to start a plan.",
    "If you fear you may harm yourself or someone else, seek urgent local help — this app is not an emergency service.",
  ],
  recommendations: [
    {
      planSlug: "anger-frustration",
      reason:
        "A free Anger Management pathway for triggers, pausing, regulation, and assertive communication.",
      domains: [
        "anger_intensity",
        "anger_impulse",
        "anger_consequences",
        "anger_triggers",
        "anger_body",
        "anger_recovery",
        "anger_communication",
        "anger_coping",
      ],
    },
    {
      planSlug: "emotional-balance",
      reason: "Steady practices when frustration spills into daily life.",
      domains: ["anger_impulse", "anger_communication"],
    },
    {
      planSlug: "stress-burnout",
      reason: "Support when anger rides on top of ongoing pressure.",
      domains: ["anger_intensity", "anger_consequences"],
    },
  ],
  primaryNextStep: {
    label: "Preview Anger Management plan",
    href: "/wellness-plan?plan=anger-frustration",
  },
  effectiveDate: "2026-10-24",
  icon: "flame",
};
