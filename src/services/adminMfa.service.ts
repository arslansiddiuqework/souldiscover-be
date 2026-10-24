import crypto from "crypto";
import { authenticator } from "otplib";

authenticator.options = { window: 1 };

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export function buildOtpauthUrl(email: string, secret: string): string {
  const issuer = encodeURIComponent(
    process.env.ADMIN_MFA_ISSUER || "Soul Discovery Admin"
  );
  const label = encodeURIComponent(email);
  return `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.check(String(token).replace(/\s/g, ""), secret);
  } catch {
    return false;
  }
}

export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

/** Returns plaintext recovery codes once; store only hashes. */
export function generateRecoveryCodes(count = 10): {
  codes: string[];
  hashes: string[];
} {
  const codes: string[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto.randomBytes(5).toString("hex").toUpperCase();
    codes.push(code);
    hashes.push(hashRecoveryCode(code));
  }
  return { codes, hashes };
}

export function consumeRecoveryCode(
  code: string,
  hashes: string[]
): { ok: true; remaining: string[] } | { ok: false } {
  const target = hashRecoveryCode(code);
  const idx = hashes.indexOf(target);
  if (idx === -1) return { ok: false };
  const remaining = [...hashes.slice(0, idx), ...hashes.slice(idx + 1)];
  return { ok: true, remaining };
}

export function isMfaEnforced(): boolean {
  return process.env.ADMIN_MFA_ENFORCE === "true";
}
