// ── Twilio Type Definitions ───────────────────────────────────────────────────

export interface TwilioCallResult {
  success: boolean;
  callSid?: string;
  error?: string;
}

export interface EmergencyContactInfo {
  name: string;
  phone: string;
  relationship: string;
}

export interface TwilioWebhookBody {
  CallSid:       string;
  SpeechResult?: string;
  Confidence?:   string;
  CallStatus?:   string;
  To?:           string;
  From?:         string;
}
