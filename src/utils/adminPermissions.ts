/**
 * Canonical admin permission catalog — keep FE/BE in sync.
 */

export const ADMIN_PERMISSIONS = [
  "users.read",
  "users.block",
  "users.delete",
  "sessions.read",
  "sessions.write",
  "consultations.write",
  "emergency.read",
  "analytics.read",
  "logs.read",
  "settings.read",
  "settings.update",
  "security.audit.read",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number];

/** Default permissions for a new non-superAdmin account. */
export const DEFAULT_ADMIN_PERMISSIONS: AdminPermission[] = [
  "users.read",
  "users.block",
  "sessions.read",
  "emergency.read",
  "analytics.read",
  "logs.read",
];

export function isKnownPermission(p: string): p is AdminPermission {
  return (ADMIN_PERMISSIONS as readonly string[]).includes(p);
}
