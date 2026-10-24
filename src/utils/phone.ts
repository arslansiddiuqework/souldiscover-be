/** E.164: + then country code and subscriber number (8–15 digits total after +). */
const E164 = /^\+[1-9]\d{7,14}$/;

export function isValidE164(phone: unknown): phone is string {
  return typeof phone === "string" && E164.test(phone.trim());
}

export function normalizeE164(phone: unknown): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim().replace(/[\s()-]/g, "");
  if (!isValidE164(trimmed)) return null;
  return trimmed;
}

export function redactPhone(phone?: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••${digits.slice(-4)}`;
}
