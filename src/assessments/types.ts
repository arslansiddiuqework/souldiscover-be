/**
 * Assessment Center — shared domain types.
 * Clinical scoring rules must come from verified instruments only.
 */

export type AssessmentCategory =
  | "emotional_wellbeing"
  | "focus_functioning"
  | "thoughts_behaviors"
  | "trauma_specialist"
  | "general"
  | "starting_point";

export type AssessmentTypeBadge =
  | "clinical_screening"
  | "self_reflection"
  | "educational"
  | "check_in"
  | "finder";

export type PublicationStatus = "draft" | "published" | "coming_soon" | "archived";

export type AnswerOption = {
  id: string;
  label: string;
  value: number | string;
};

export type AssessmentQuestion = {
  id: string;
  text: string;
  helpText?: string;
  required: boolean;
  allowSkip?: boolean;
  responseType: "single" | "multi";
  options: AnswerOption[];
  reverseScored?: boolean;
  /** Show only when prior answers match (simple branching). */
  showIf?: { questionId: string; values: Array<number | string> };
  domain?: string;
};

export type ScoringMethod =
  | "none"
  | "sum"
  | "reflection_domains"
  | "starting_point_routing";

export type ThresholdBand = {
  id: string;
  min: number;
  max: number;
  label: string;
  description: string;
};

export type ReflectionDomainRule = {
  domain: string;
  questionIds: string[];
  /** Higher numeric answers mean more of this experience. */
  polarity: "positive" | "challenge";
  /** Average at/above this (0–4 scale) flags the domain. */
  attentionThreshold: number;
  goingWellThreshold: number;
};

export type InstrumentLicense = {
  source: string;
  license: string;
  clinicallyValidated: boolean;
  attribution?: string;
  notes?: string;
};

export type WellnessRecommendation = {
  planSlug: string;
  reason: string;
  domains?: string[];
};

export type AssessmentDefinition = {
  id: string;
  slug: string;
  version: string;
  title: string;
  shortDescription: string;
  longDescription: string;
  category: AssessmentCategory;
  typeBadge: AssessmentTypeBadge;
  estimatedMinutes: number;
  audience: string;
  ageMin?: number;
  ageMax?: number;
  referencePeriod?: string;
  privacyNote?: string;
  status: PublicationStatus;
  clinicallyValidated: boolean;
  requiresAcknowledgment: boolean;
  questionCount: number;
  questions: AssessmentQuestion[];
  scoringMethod: ScoringMethod;
  thresholds?: ThresholdBand[];
  reflectionDomains?: ReflectionDomainRule[];
  license: InstrumentLicense;
  whatItExplores: string[];
  whatHappensAfter: string[];
  recommendations: WellnessRecommendation[];
  primaryNextStep: {
    label: string;
    href: string;
    rule?: string;
  };
  effectiveDate: string;
  icon: string;
};

export type AnswerPayload = {
  questionId: string;
  value: number | string | Array<number | string> | null;
  skipped?: boolean;
};

export type ScoringResult = {
  instrumentId: string;
  instrumentVersion: string;
  scoringMethod: ScoringMethod;
  clinicallyValidated: boolean;
  totalScore: number | null;
  maxScore: number | null;
  interpretationLabel: string | null;
  interpretationSummary: string;
  domains: Array<{
    domain: string;
    average: number | null;
    status: "going_well" | "attention" | "neutral" | "skipped";
    note: string;
  }>;
  goingWell: string[];
  needsAttention: string[];
  smallStep: string;
  suggestedPlanSlugs: string[];
  /** Starting-point finder only — suggested assessment slugs. */
  suggestedAssessmentSlugs?: string[];
  educationalTips?: string[];
  disclaimer: string;
  answeredCount: number;
  skippedCount: number;
};

export type StartingPointSuggestion = {
  reason: string;
  assessmentSlugs: string[];
  educationalTips: string[];
};
