import { AssessmentDefinition, StartingPointSuggestion } from "../types";

/**
 * Universal starting assessment — routes users to relevant reflections.
 * Answers are never treated as a diagnosis or clinical risk score.
 */
export const startingPointFinder: AssessmentDefinition = {
  id: "starting-point-finder",
  slug: "starting-point-finder",
  version: "1.0.0",
  title: "Not sure where to start?",
  shortDescription:
    "A brief, non-diagnostic check-in that suggests relevant assessments and resources.",
  longDescription:
    "Answer a few optional questions about what you would like to explore. We use your answers only to suggest relevant assessments and educational resources — never as a diagnosis or clinical risk score.",
  category: "starting_point",
  typeBadge: "finder",
  estimatedMinutes: 2,
  audience: "Adults (18+)",
  ageMin: 18,
  privacyNote: "These answers are used only to suggest next steps.",
  status: "published",
  clinicallyValidated: false,
  requiresAcknowledgment: false,
  questionCount: 2,
  questions: [
    {
      id: "explore",
      text: "What would you like to explore right now?",
      helpText: "Choose the option that feels closest. You can always browse all assessments.",
      required: true,
      responseType: "single",
      options: [
        { id: "mood_low", label: "My mood has felt low.", value: "mood_low" },
        {
          id: "worried",
          label: "I have been feeling worried or anxious.",
          value: "worried",
        },
        {
          id: "stressed",
          label: "I feel stressed or overwhelmed.",
          value: "stressed",
        },
        {
          id: "focus",
          label: "I am struggling with focus or motivation.",
          value: "focus",
        },
        {
          id: "sleep",
          label: "My sleep or energy has changed.",
          value: "sleep",
        },
        {
          id: "thoughts",
          label: "My thoughts or habits have been bothering me.",
          value: "thoughts",
        },
        {
          id: "understand",
          label: "I want to understand myself better.",
          value: "understand",
        },
        { id: "unsure", label: "I am not sure yet.", value: "unsure" },
      ],
    },
    {
      id: "hope",
      text: "What do you hope to get from this experience?",
      required: true,
      responseType: "single",
      options: [
        {
          id: "feelings",
          label: "Understand my feelings.",
          value: "feelings",
        },
        {
          id: "habits",
          label: "Explore my habits and patterns.",
          value: "habits",
        },
        {
          id: "practical",
          label: "Find practical ways to feel better.",
          value: "practical",
        },
        {
          id: "support",
          label: "Understand whether professional support might help.",
          value: "support",
        },
      ],
    },
  ],
  scoringMethod: "starting_point_routing",
  license: {
    source: "Soul Discovery — original starting-point finder",
    license: "Proprietary original content; not a clinical instrument",
    clinicallyValidated: false,
  },
  whatItExplores: [
    "What you would like to check in on",
    "What kind of support or understanding you are hoping for",
  ],
  whatHappensAfter: [
    "You receive suggested assessments and educational tips.",
    "You can still browse the full Assessment Center anytime.",
  ],
  recommendations: [],
  primaryNextStep: {
    label: "Browse all assessments",
    href: "/assessments",
  },
  effectiveDate: "2026-03-26",
  icon: "compass",
};

const ROUTING: Record<
  string,
  { assessments: string[]; tip: string }
> = {
  mood_low: {
    assessments: ["daily-wellbeing-reflection", "stress-check-in"],
    tip: "A mood check-in can help you notice patterns without labeling them as a diagnosis.",
  },
  worried: {
    assessments: ["daily-wellbeing-reflection", "stress-check-in"],
    tip: "Short reflections and calm wellness activities can help you explore worry gently.",
  },
  stressed: {
    assessments: ["stress-check-in", "anger-management", "daily-wellbeing-reflection"],
    tip: "Naming what feels overwhelming — including frustration — is a useful first step toward practical support.",
  },
  focus: {
    assessments: ["daily-wellbeing-reflection", "stress-check-in"],
    tip: "Focus and motivation often connect with rest, stress, and energy — a reflection can help.",
  },
  sleep: {
    assessments: ["sleep-rest-check-in", "daily-wellbeing-reflection"],
    tip: "Sleep and energy changes are common. A rest check-in can highlight gentle next steps.",
  },
  thoughts: {
    assessments: ["daily-wellbeing-reflection", "stress-check-in"],
    tip: "Noticing thoughts and habits through reflection is different from diagnosing a condition.",
  },
  understand: {
    assessments: ["daily-wellbeing-reflection"],
    tip: "Start with a broad well-being reflection, then explore more specific check-ins if you wish.",
  },
  unsure: {
    assessments: ["daily-wellbeing-reflection", "starting-point-finder"],
    tip: "When you are unsure, a short daily well-being reflection is a calm place to begin.",
  },
};

export function suggestFromStartingPoint(
  explore: string,
  hope: string
): StartingPointSuggestion {
  const route = ROUTING[explore] || ROUTING.unsure;
  const educationalTips = [route.tip];

  if (hope === "feelings") {
    educationalTips.push(
      "Results describe patterns you reflected on — they are not a clinical diagnosis."
    );
  } else if (hope === "habits") {
    educationalTips.push(
      "Look for themes across mood, rest, stress, and focus rather than a single number."
    );
  } else if (hope === "practical") {
    educationalTips.push(
      "After reflecting, try one free wellness activity that fits what you noticed."
    );
  } else if (hope === "support") {
    educationalTips.push(
      "Screening and reflection can help you decide whether to speak with a qualified professional. They do not replace professional care."
    );
  }

  educationalTips.push(
    "You can browse all assessments without answering these questions."
  );

  return {
    reason: `Based on what you shared, these reflections may be a helpful starting point.`,
    assessmentSlugs: route.assessments.filter((s) => s !== "starting-point-finder"),
    educationalTips,
  };
}
