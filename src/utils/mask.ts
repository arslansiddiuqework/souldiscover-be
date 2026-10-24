/** Mask phone-like strings for list views (keeps last 4 digits when possible). */
export function maskPhone(value?: string | null): string {
  if (!value) return "";
  const digits = String(value).replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••${digits.slice(-4)}`;
}

export function maskEmail(value?: string | null): string {
  if (!value) return "";
  const [local, domain] = String(value).split("@");
  if (!domain) return "•••";
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}•••@${domain}`;
}
