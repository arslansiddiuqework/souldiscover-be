import jwt, { JwtPayload, SignOptions } from "jsonwebtoken";

export type UserTokenPurpose = "access" | "password_reset";
export type AdminTokenPurpose =
  | "admin_access"
  | "admin_password_reset"
  | "admin_mfa_challenge";

type UserAccessClaims = {
  userId: string;
  typ: "access";
  tv?: number;
};

type UserResetClaims = {
  userId: string;
  typ: "password_reset";
};

type AdminAccessClaims = {
  adminId: string;
  role: string;
  typ: "admin_access";
  tv?: number;
};

type AdminResetClaims = {
  adminId: string;
  typ: "admin_password_reset";
};

type AdminMfaChallengeClaims = {
  adminId: string;
  typ: "admin_mfa_challenge";
  tv?: number;
};

/**
 * Require JWT_SECRET in production / Vercel. Local/dev may use a clearly
 * non-production fallback so bootstrapping without .env still works — never
 * rely on that fallback in deployed environments.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  const isProd =
    process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  if (isProd) {
    throw new Error(
      "JWT_SECRET is not configured. Set a strong secret in the environment."
    );
  }
  return "dev-only-insecure-jwt-secret-change-me";
}

/** Prefer ADMIN_JWT_SECRET when set; otherwise fall back to JWT_SECRET. */
export function getAdminJwtSecret(): string {
  const adminSecret = process.env.ADMIN_JWT_SECRET?.trim();
  if (adminSecret) return adminSecret;
  return getJwtSecret();
}

function adminAccessTtl(): SignOptions["expiresIn"] {
  const raw = (process.env.ADMIN_JWT_TTL || "8h").trim();
  return raw as SignOptions["expiresIn"];
}

const VERIFY_OPTS = {
  algorithms: ["HS256"] as jwt.Algorithm[],
};

export function signUserAccessToken(
  userId: string,
  tokenVersion = 0,
  expiresIn: SignOptions["expiresIn"] = "24h"
): string {
  const payload: UserAccessClaims = {
    userId,
    typ: "access",
    tv: tokenVersion,
  };
  return jwt.sign(payload, getJwtSecret(), { expiresIn, algorithm: "HS256" });
}

export function signUserResetToken(userId: string): string {
  const payload: UserResetClaims = { userId, typ: "password_reset" };
  return jwt.sign(payload, getJwtSecret(), {
    expiresIn: "15m",
    algorithm: "HS256",
  });
}

export function verifyUserAccessToken(token: string): UserAccessClaims {
  const decoded = jwt.verify(token, getJwtSecret(), VERIFY_OPTS) as JwtPayload & {
    userId?: string;
    typ?: string;
    tv?: number;
  };
  if (!decoded?.userId) {
    throw new Error("Invalid access token payload");
  }
  // Reject password-reset tokens used as sessions (token confusion).
  if (decoded.typ === "password_reset") {
    throw new Error("Password reset token cannot be used for authentication");
  }
  // Accept legacy tokens without typ during rollout (issued before this fix).
  if (decoded.typ && decoded.typ !== "access") {
    throw new Error("Invalid token type");
  }
  return {
    userId: String(decoded.userId),
    typ: "access",
    tv: typeof decoded.tv === "number" ? decoded.tv : 0,
  };
}

export function verifyUserResetToken(token: string): UserResetClaims {
  const decoded = jwt.verify(token, getJwtSecret(), VERIFY_OPTS) as JwtPayload &
    Partial<UserResetClaims>;
  if (!decoded?.userId) {
    throw new Error("Invalid reset token payload");
  }
  // Require explicit purpose so ordinary access JWTs cannot reset passwords.
  if (decoded.typ !== "password_reset") {
    throw new Error("Invalid reset token type");
  }
  return { userId: String(decoded.userId), typ: "password_reset" };
}

export function signAdminAccessToken(
  adminId: string,
  role: string,
  tokenVersion = 0,
  expiresIn: SignOptions["expiresIn"] = adminAccessTtl()
): string {
  const payload: AdminAccessClaims = {
    adminId,
    role,
    typ: "admin_access",
    tv: tokenVersion,
  };
  return jwt.sign(payload, getAdminJwtSecret(), {
    expiresIn,
    algorithm: "HS256",
  });
}

export function signAdminResetToken(adminId: string): string {
  const payload: AdminResetClaims = {
    adminId,
    typ: "admin_password_reset",
  };
  return jwt.sign(payload, getAdminJwtSecret(), {
    expiresIn: "15m",
    algorithm: "HS256",
  });
}

export function signAdminMfaChallengeToken(
  adminId: string,
  tokenVersion = 0
): string {
  const payload: AdminMfaChallengeClaims = {
    adminId,
    typ: "admin_mfa_challenge",
    tv: tokenVersion,
  };
  return jwt.sign(payload, getAdminJwtSecret(), {
    expiresIn: "5m",
    algorithm: "HS256",
  });
}

export function verifyAdminAccessToken(token: string): AdminAccessClaims {
  const decoded = jwt.verify(
    token,
    getAdminJwtSecret(),
    VERIFY_OPTS
  ) as JwtPayload & {
    adminId?: string;
    role?: string;
    typ?: string;
    tv?: number;
  };
  if (!decoded?.adminId) {
    throw new Error("Invalid admin access token payload");
  }
  if (
    decoded.typ === "admin_password_reset" ||
    decoded.typ === "password_reset" ||
    decoded.typ === "admin_mfa_challenge"
  ) {
    throw new Error("Token cannot be used for admin authentication");
  }
  if (decoded.typ && decoded.typ !== "admin_access") {
    throw new Error("Invalid admin token type");
  }
  return {
    adminId: String(decoded.adminId),
    role: String(decoded.role || ""),
    typ: "admin_access",
    tv: typeof decoded.tv === "number" ? decoded.tv : 0,
  };
}

export function verifyAdminResetToken(token: string): AdminResetClaims {
  const decoded = jwt.verify(
    token,
    getAdminJwtSecret(),
    VERIFY_OPTS
  ) as JwtPayload & Partial<AdminResetClaims>;
  if (!decoded?.adminId) {
    throw new Error("Invalid admin reset token payload");
  }
  if (decoded.typ !== "admin_password_reset") {
    throw new Error("Invalid admin reset token type");
  }
  return { adminId: String(decoded.adminId), typ: "admin_password_reset" };
}

export function verifyAdminMfaChallengeToken(
  token: string
): AdminMfaChallengeClaims {
  const decoded = jwt.verify(
    token,
    getAdminJwtSecret(),
    VERIFY_OPTS
  ) as JwtPayload & Partial<AdminMfaChallengeClaims>;
  if (!decoded?.adminId || decoded.typ !== "admin_mfa_challenge") {
    throw new Error("Invalid MFA challenge token");
  }
  return {
    adminId: String(decoded.adminId),
    typ: "admin_mfa_challenge",
    tv: typeof decoded.tv === "number" ? decoded.tv : 0,
  };
}
