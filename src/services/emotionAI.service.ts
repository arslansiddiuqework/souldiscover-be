import { logger } from "../utils/logger";
import { groq1, groq2 } from "./llm.service";

const MODEL_NAME = "llama-3.1-8b-instant";

// ── Types ──────────────────────────────────────────────────────
export interface EmotionAIParams {
  userMessage: string;
  recentMessages: string;
  sessionSummary: string;
  latestMood: "low" | "neutral" | "positive" | "unknown";
}

export interface EmotionAIResult {
  emotion: "panic" | "stress" | "low" | "neutral" | "positive";
  intensity: number;
  suggestedActivity: "breathing" | "ocean" | "forest" | "zen" | "rain" | "campfire" | null;
  autoTrigger: boolean;
  // ── Crisis fields (Phase 1 extension) ──────────────────────
  crisisRiskScore?: number;
  suicideRisk?: number;
  selfHarmRisk?: number;
  panicSeverity?: number;
  escalationRecommended?: boolean;
  escalationReason?: string;
  musicRecommendation?: {
    mood: string;
    reason: string;
  } | null;
}

// ── Smart Gate ────────────────────────────────────────────────
function isGreeting(message: string): boolean {
  const greetings = ["hi", "hello", "hey", "hola", "greetings", "yo", "morning", "evening", "night"];
  const trimmed = message.trim().toLowerCase();
  // Remove punctuation for better matching
  const clean = trimmed.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");
  return greetings.includes(clean);
}

// ── Robust JSON Parser ────────────────────────────────────────
function safeJsonParse(text: string): any {
  try {
    // 1. Try direct parse
    return JSON.parse(text);
  } catch (e) {
    try {
      // 2. Try to extract JSON from markdown or extra text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e2) {
      logger.warn("🧠 emotionAI: Failed to parse JSON even after extraction", { text });
    }
    return null;
  }
}

// ── Fallback Heuristic (Task 3: Hybrid System) ────────────────
function fallbackAnalysis(message: string, latestMood: string): EmotionAIResult {
  const lowercaseMsg = message.toLowerCase();

  // ── CRITICAL Keywords (RiskLevel: CRITICAL) ──────────────────
  const criticalKeywords = [
    "kill myself", "end my life", "suicide", "will end my life", 
    "want to kill myself", "better off dead", "don't want to live anymore",
    "cannot live anymore", "taking my life", "hanging myself", "swallow pills"
  ];
  
  // ── HIGH Keywords (RiskLevel: HIGH) ──────────────────────────
  const highKeywords = [
    "want to die", "no reason to live", "done living", "wish i was dead",
    "end it all", "i'm done", "life is over", "hurt myself", "cutting"
  ];

  // ── MEDIUM Keywords (RiskLevel: MEDIUM) ──────────────────────
  const mediumKeywords = [
    "hopeless", "trapped", "no future", "panic", "anxiety", "scared",
    "help me", "can't cope", "overwhelmed"
  ];

  const hasCritical = criticalKeywords.some(kw => lowercaseMsg.includes(kw));
  const hasHigh = highKeywords.some(kw => lowercaseMsg.includes(kw));
  const hasMedium = mediumKeywords.some(kw => lowercaseMsg.includes(kw));

  if (hasCritical) {
    return {
      emotion: "low", intensity: 1.0, suggestedActivity: null, autoTrigger: true,
      crisisRiskScore: 0.95, suicideRisk: 0.95, selfHarmRisk: 0.5, panicSeverity: 0.5,
      escalationRecommended: true, escalationReason: "Critical suicide keywords detected",
      musicRecommendation: null
    };
  }

  if (hasHigh) {
    return {
      emotion: "low", intensity: 0.9, suggestedActivity: null, autoTrigger: true,
      crisisRiskScore: 0.85, suicideRisk: 0.8, selfHarmRisk: 0.7, panicSeverity: 0.4,
      escalationRecommended: true, escalationReason: "High risk emotional distress keywords",
      musicRecommendation: { mood: "Calm Piano", reason: "Soothe high distress" }
    };
  }

  if (hasMedium) {
    // Rotate through a variety of calming activities including rain and campfire
    const mediumActivities: ("breathing" | "rain" | "campfire" | "ocean" | "forest")[] = ["breathing", "rain", "campfire", "ocean", "forest"];
    const activity = mediumActivities[Math.floor(Math.random() * mediumActivities.length)];
    return {
      emotion: "stress", intensity: 0.75, suggestedActivity: activity, autoTrigger: false,
      crisisRiskScore: 0.5, suicideRisk: 0.2, selfHarmRisk: 0.2, panicSeverity: 0.6,
      escalationRecommended: false, escalationReason: "Medium distress detected",
      musicRecommendation: { mood: "Meditation Music", reason: "Help reduce stress and anxiety" }
    };
  }

  return { emotion: "neutral", intensity: 0.1, suggestedActivity: null, autoTrigger: false, musicRecommendation: null };
}

// ── Main Analysis Function ─────────────────────────────────────
export async function analyzeUserState(params: EmotionAIParams): Promise<EmotionAIResult> {
  // ── Smart Gate ──
  if (params.userMessage.length < 5 || isGreeting(params.userMessage)) {
    return fallbackAnalysis(params.userMessage, params.latestMood);
  }

  const systemPrompt = `You are a deterministic crisis classifier. Output ONLY valid JSON.
No markdown. No extra text. No explanations.
SCHEMA:
{
  "emotion": "panic"|"stress"|"low"|"neutral"|"positive",
  "intensity": 0.0-1.0,
  "suggestedActivity": "breathing"|"ocean"|"forest"|"zen"|"rain"|"campfire"|null, // CRITICAL: RANDOMIZE THIS! Do not just suggest 'breathing' every time. Pick different ones.
  "autoTrigger": boolean,
  "crisisRiskScore": 0.0-1.0,
  "suicideRisk": 0.0-1.0,
  "selfHarmRisk": 0.0-1.0,
  "panicSeverity": 0.0-1.0,
  "riskLevel": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL",
  "escalationRecommended": boolean,
  "escalationReason": "string",
  "musicRecommendation": {
    "mood": "Calm Piano" | "Nature Sounds" | "Deep Focus" | "Meditation Music" | "Sleep Sounds" | "Positive Acoustic" | "Comfort Music" | "Breathing Music",
    "reason": "string"
  } | null
}

IMPORTANT: To avoid repetitive user experiences, you MUST randomize the "suggestedActivity" and "musicRecommendation" fields. Do NOT always suggest "breathing". Rotate through all available activities and music moods appropriately.`;

  const userPrompt = `User Message: "${params.userMessage}"`;

  const keys = [groq1, groq2];
  
  for (let i = 0; i < keys.length; i++) {
    const groq = keys[i];
    try {
      const completion = await groq.chat.completions.create({
        model: MODEL_NAME,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        max_tokens: 150,
        temperature: 0,
        response_format: { type: "json_object" }
      }, { timeout: 2000 });

      const text = completion.choices[0]?.message?.content || "{}";
      const data = safeJsonParse(text);

      if (!data) throw new Error("Invalid JSON from Groq");

      const finalResult: EmotionAIResult = {
        emotion: data.emotion || "neutral",
        intensity: data.intensity || 0.1,
        suggestedActivity: (data.suggestedActivity === "null" || !data.suggestedActivity) ? null : data.suggestedActivity,
        autoTrigger: data.autoTrigger || false,
        crisisRiskScore: Number(data.crisisRiskScore) || 0,
        suicideRisk: Number(data.suicideRisk) || 0,
        selfHarmRisk: Number(data.selfHarmRisk) || 0,
        panicSeverity: Number(data.panicSeverity) || 0,
        escalationRecommended: !!data.escalationRecommended || (data.riskLevel === "HIGH" || data.riskLevel === "CRITICAL"),
        escalationReason: data.escalationReason || "Assessment",
        musicRecommendation: data.musicRecommendation || null,
      };

      logger.info("🧠 emotionAI: Analysis Complete", { risk: data.riskLevel, score: finalResult.crisisRiskScore });
      return finalResult;
      
    } catch (error) {
      logger.warn(`⚠️ emotionAI: Groq Key ${i + 1} failed, ${i === 0 ? 'switching...' : 'falling back to heuristic'}`, { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // If both keys fail, use heuristic
  return fallbackAnalysis(params.userMessage, params.latestMood);
}
