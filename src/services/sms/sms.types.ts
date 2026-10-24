export type SmsDeliveryStatus =
  | "accepted"
  | "queued"
  | "pending"
  | "sent"
  | "delivered"
  | "failed"
  | "unknown";

export type SmsSendResult =
  | {
      ok: true;
      provider: "textbee";
      smsBatchId: string;
      status: SmsDeliveryStatus;
      recipientCount?: number;
      warningCode?: string;
      warningMessage?: string;
      rawMessage?: string;
    }
  | {
      ok: false;
      provider: "textbee";
      error: string;
      code:
        | "not_configured"
        | "invalid_number"
        | "invalid_message"
        | "http_400"
        | "http_401"
        | "http_429"
        | "timeout"
        | "network"
        | "malformed_response"
        | "unknown";
      httpStatus?: number;
    };

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  sendSms(input: {
    to: string;
    message: string;
    /** Optional idempotency key for caller-side dedupe logging */
    idempotencyKey?: string;
  }): Promise<SmsSendResult>;
}
