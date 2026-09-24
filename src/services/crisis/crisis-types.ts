// ── Crisis System Type Definitions ────────────────────────────────────────────
// These types are ONLY consumed by the crisis/escalation module.
// The rest of Soul Discovery is unaffected.

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface CrisisAssessment {
  riskLevel: RiskLevel;
  crisisRiskScore: number;   // 0.0–1.0
  suicideRisk: number;       // 0.0–1.0
  selfHarmRisk: number;      // 0.0–1.0
  panicSeverity: number;     // 0.0–1.0
  escalationRecommended: boolean;
  escalationReason?: string;
  recommendedAction?: string;
  confidence: number;        // 0.0–1.0 — how sure we are
}

export interface EscalationDecision {
  shouldEscalate: boolean;
  reason: string;
  blockedBy?: 
    | "cooldown"
    | "session_duplicate"
    | "no_consent"
    | "disabled"
    | "low_confidence"
    | "no_contacts"
    | "max_per_day"
    | "twilio_not_configured";
}

export interface CrisisContext {
  userId: string;
  sessionId: string;
  userName: string;
  assessment: CrisisAssessment;
  emotionalSummary: string;
  triggeringStatements: string[];
  recommendedAction: string;
}

export interface ActiveCallSession {
  callSid: string;
  userId: string;
  sessionId: string;
  contactName: string;
  contactPhone: string;
  crisisContext: CrisisContext;
  conversationHistory: Array<{ role: "ai" | "contact"; content: string }>;
  startedAt: Date;
}
