const MIN_LENGTH = 8;
const MAX_LENGTH = 72; // bcrypt truncates beyond 72 bytes

export function validatePasswordStrength(
  password: unknown
): { ok: true } | { ok: false; message: string } {
  if (typeof password !== "string") {
    return { ok: false, message: "Password is required." };
  }
  if (password.length < MIN_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${MIN_LENGTH} characters.`,
    };
  }
  if (Buffer.byteLength(password, "utf8") > MAX_LENGTH) {
    return {
      ok: false,
      message: `Password must be at most ${MAX_LENGTH} bytes.`,
    };
  }
  return { ok: true };
}

export function normalizeEmail(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const trimmed = email.trim().toLowerCase();
  if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  if (trimmed.length > 254) return null;
  return trimmed;
}
