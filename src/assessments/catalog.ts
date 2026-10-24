import { AssessmentDefinition } from "./types";
import { angerManagementReflection } from "./instruments/anger-management";
import { dailyWellbeingReflection } from "./instruments/daily-wellbeing";
import { stressCheckIn } from "./instruments/stress-checkin";
import { sleepCheckIn } from "./instruments/sleep-checkin";
import { startingPointFinder } from "./instruments/starting-point";

function comingSoon(partial: {
  id: string;
  slug: string;
  title: string;
  shortDescription: string;
  category: AssessmentDefinition["category"];
  typeBadge: AssessmentDefinition["typeBadge"];
  audience: string;
  estimatedMinutes: number;
  icon: string;
  licenseNotes: string;
  ageMin?: number;
}): AssessmentDefinition {
  return {
    id: partial.id,
    slug: partial.slug,
    version: "0.0.0-pending",
    title: partial.title,
    shortDescription: partial.shortDescription,
    longDescription: `${partial.shortDescription} This assessment is listed for transparency while we verify the applicable instrument version, scoring rules, licensing, and attribution requirements. It cannot be started until those checks are complete.`,
    category: partial.category,
    typeBadge: partial.typeBadge,
    estimatedMinutes: partial.estimatedMinutes,
    audience: partial.audience,
    ageMin: partial.ageMin,
    status: "coming_soon",
    clinicallyValidated: false,
    requiresAcknowledgment: true,
    questionCount: 0,
    questions: [],
    scoringMethod: "none",
    license: {
      source: "Pending verification",
      license: "Not yet authorized for implementation",
      clinicallyValidated: false,
      notes: partial.licenseNotes,
    },
    whatItExplores: [
      "Instrument wording and scoring pending licensing review",
    ],
    whatHappensAfter: [
      "This assessment is not available to start yet.",
      "You can explore published Soul Discovery reflections in the meantime.",
    ],
    recommendations: [],
    primaryNextStep: {
      label: "Browse available reflections",
      href: "/assessments",
    },
    effectiveDate: "2026-03-26",
    icon: partial.icon,
    privacyNote: "Coming soon — not yet collecting responses.",
  };
}

const PENDING: AssessmentDefinition[] = [
  comingSoon({
    id: "depression-symptoms-screening",
    slug: "depression-symptoms-screening",
    title: "Depression Symptoms Screening",
    shortDescription:
      "Explore recent changes in mood, interest, energy, sleep, and everyday functioning.",
    category: "emotional_wellbeing",
    typeBadge: "clinical_screening",
    audience: "Adults (18+)",
    estimatedMinutes: 5,
    icon: "cloud-rain",
    licenseNotes:
      "Candidate instrument: PHQ-9 — pending verification of version, scoring, and attribution requirements.",
  }),
  comingSoon({
    id: "anxiety-symptoms-screening",
    slug: "anxiety-symptoms-screening",
    title: "Anxiety Symptoms Screening",
    shortDescription:
      "Reflect on worry, nervousness, tension, and difficulty managing anxious thoughts.",
    category: "emotional_wellbeing",
    typeBadge: "clinical_screening",
    audience: "Adults (18+)",
    estimatedMinutes: 4,
    icon: "waves",
    licenseNotes:
      "Candidate instrument: GAD-7 — pending verification of version, scoring, and attribution requirements.",
  }),
  comingSoon({
    id: "social-anxiety-screening",
    slug: "social-anxiety-screening",
    title: "Social Anxiety Screening",
    shortDescription:
      "Explore discomfort, worry, or fear in social situations.",
    category: "emotional_wellbeing",
    typeBadge: "clinical_screening",
    audience: "Adults (18+)",
    estimatedMinutes: 5,
    icon: "users",
    licenseNotes: "Pending licensed/validated instrument selection and rights confirmation.",
  }),
  comingSoon({
    id: "mood-patterns-education",
    slug: "mood-patterns-education",
    title: "Mood Patterns Education",
    shortDescription:
      "Learn about mood changes, sleep, energy, and daily patterns.",
    category: "emotional_wellbeing",
    typeBadge: "educational",
    audience: "Adults (18+)",
    estimatedMinutes: 8,
    icon: "book-open",
    licenseNotes:
      "Educational content only unless a separately licensed bipolar screening instrument is implemented. Will not diagnose bipolar disorder.",
  }),
  comingSoon({
    id: "attention-focus-screening",
    slug: "attention-focus-screening",
    title: "Attention and Focus Screening",
    shortDescription:
      "Explore attention, organization, task completion, and restlessness.",
    category: "focus_functioning",
    typeBadge: "clinical_screening",
    audience: "Adults (18+)",
    estimatedMinutes: 6,
    icon: "target",
    licenseNotes:
      "Requires an appropriately licensed and validated instrument. Will not be labeled as an ADHD test without authorization.",
  }),
  comingSoon({
    id: "ocd-symptoms-screening",
    slug: "ocd-symptoms-screening",
    title: "OCD Symptoms Screening",
    shortDescription:
      "Explore repetitive thoughts and behaviors that may interfere with daily life.",
    category: "thoughts_behaviors",
    typeBadge: "clinical_screening",
    audience: "Adults (18+)",
    estimatedMinutes: 6,
    icon: "repeat",
    licenseNotes: "Requires confirmed reproduction rights and validated scoring.",
  }),
  comingSoon({
    id: "eating-body-image-check-in",
    slug: "eating-body-image-check-in",
    title: "Eating and Body Image Check-In",
    shortDescription:
      "Reflect on your relationship with food, body image, and related distress.",
    category: "thoughts_behaviors",
    typeBadge: "check_in",
    audience: "Adults (18+)",
    estimatedMinutes: 6,
    icon: "heart",
    licenseNotes:
      "Pending sensitive wording review and authorized instrument selection. Will not generate diet prescriptions or diagnostic conclusions.",
  }),
  comingSoon({
    id: "substance-use-screening",
    slug: "substance-use-screening",
    title: "Substance Use Screening",
    shortDescription:
      "Explore whether substance use may be affecting your health or daily life.",
    category: "thoughts_behaviors",
    typeBadge: "clinical_screening",
    audience: "Adults (18+)",
    estimatedMinutes: 5,
    icon: "shield",
    licenseNotes:
      "Requires a suitable licensed or public-domain instrument with confirmed implementation rights.",
  }),
  comingSoon({
    id: "ptsd-symptoms-screening",
    slug: "ptsd-symptoms-screening",
    title: "PTSD Symptoms Screening",
    shortDescription:
      "A sensitive, optional screening experience for people experiencing distress following traumatic events.",
    category: "trauma_specialist",
    typeBadge: "clinical_screening",
    audience: "Adults (18+)",
    estimatedMinutes: 8,
    icon: "leaf",
    licenseNotes:
      "Requires an appropriately licensed or public-domain instrument with official wording and scoring rules.",
  }),
  comingSoon({
    id: "postpartum-emotional-wellbeing",
    slug: "postpartum-emotional-wellbeing",
    title: "Postpartum Emotional Well-being",
    shortDescription:
      "Support reflection on emotional well-being during pregnancy and after childbirth.",
    category: "trauma_specialist",
    typeBadge: "clinical_screening",
    audience: "Pregnant and postpartum adults",
    estimatedMinutes: 6,
    icon: "baby",
    licenseNotes:
      "Requires an authorized, validated perinatal instrument and suitable professional guidance.",
  }),
  comingSoon({
    id: "youth-wellbeing",
    slug: "youth-wellbeing",
    title: "Youth Well-being",
    shortDescription:
      "A developmentally appropriate experience for young people.",
    category: "trauma_specialist",
    typeBadge: "self_reflection",
    audience: "Youth — guardian consent required (pending)",
    estimatedMinutes: 8,
    icon: "sun",
    ageMin: 13,
    licenseNotes:
      "Requires age eligibility, consent, safeguarding, and guardian rules before offering. Adult catalog will not be exposed to minors.",
  }),
  comingSoon({
    id: "general-mental-wellbeing-check-in",
    slug: "general-mental-wellbeing-check-in",
    title: "General Mental Well-being Check-In",
    shortDescription:
      "A short, non-diagnostic reflection on mood, stress, sleep, energy, connection, and everyday functioning.",
    category: "general",
    typeBadge: "check_in",
    audience: "Adults (18+)",
    estimatedMinutes: 5,
    icon: "circle-dot",
    licenseNotes:
      "Superseded for now by Daily Well-being Reflection (published). This entry remains for catalog completeness.",
  }),
];

/** In-memory catalog. Admin publish/unpublish overlays may be added later via DB. */
export const ASSESSMENT_CATALOG: AssessmentDefinition[] = [
  startingPointFinder,
  dailyWellbeingReflection,
  stressCheckIn,
  sleepCheckIn,
  angerManagementReflection,
  ...PENDING,
];

const bySlug = new Map(ASSESSMENT_CATALOG.map((a) => [a.slug, a]));
const byId = new Map(ASSESSMENT_CATALOG.map((a) => [a.id, a]));

export function listAssessments(options?: {
  includeComingSoon?: boolean;
  category?: string;
  search?: string;
  status?: string;
}): AssessmentDefinition[] {
  const includeComingSoon = options?.includeComingSoon !== false;
  let items = ASSESSMENT_CATALOG.filter((a) => a.status !== "archived");

  if (!includeComingSoon) {
    items = items.filter((a) => a.status === "published");
  }
  if (options?.status && options.status !== "all") {
    items = items.filter((a) => a.status === options.status);
  }
  if (options?.category && options.category !== "all") {
    items = items.filter((a) => a.category === options.category);
  }
  if (options?.search) {
    const q = options.search.toLowerCase().trim();
    items = items.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.shortDescription.toLowerCase().includes(q) ||
        a.audience.toLowerCase().includes(q)
    );
  }

  return items;
}

export function getAssessmentBySlug(slug: string): AssessmentDefinition | undefined {
  return bySlug.get(slug);
}

export function getAssessmentById(id: string): AssessmentDefinition | undefined {
  return byId.get(id);
}

export function toPublicCard(def: AssessmentDefinition) {
  return {
    id: def.id,
    slug: def.slug,
    version: def.version,
    title: def.title,
    shortDescription: def.shortDescription,
    category: def.category,
    typeBadge: def.typeBadge,
    estimatedMinutes: def.estimatedMinutes,
    audience: def.audience,
    privacyNote: def.privacyNote,
    status: def.status,
    clinicallyValidated: def.clinicallyValidated,
    free: true,
    icon: def.icon,
    questionCount: def.questionCount,
  };
}

export function toOverview(def: AssessmentDefinition) {
  return {
    ...toPublicCard(def),
    longDescription: def.longDescription,
    referencePeriod: def.referencePeriod,
    whatItExplores: def.whatItExplores,
    whatHappensAfter: def.whatHappensAfter,
    requiresAcknowledgment: def.requiresAcknowledgment,
    license: {
      source: def.license.source,
      clinicallyValidated: def.license.clinicallyValidated,
      attribution: def.license.attribution,
      notes: def.license.notes,
    },
    canStart: def.status === "published" && def.questions.length > 0,
    primaryNextStep: def.primaryNextStep,
  };
}

export function toTakePayload(def: AssessmentDefinition) {
  if (def.status !== "published" || def.questions.length === 0) {
    return null;
  }
  return {
    id: def.id,
    slug: def.slug,
    version: def.version,
    title: def.title,
    referencePeriod: def.referencePeriod,
    clinicallyValidated: def.clinicallyValidated,
    requiresAcknowledgment: def.requiresAcknowledgment,
    questions: def.questions.map((q) => ({
      id: q.id,
      text: q.text,
      helpText: q.helpText,
      required: q.required,
      allowSkip: q.allowSkip ?? !q.required,
      responseType: q.responseType,
      options: q.options.map((o) => ({ id: o.id, label: o.label, value: o.value })),
      showIf: q.showIf,
    })),
  };
}
