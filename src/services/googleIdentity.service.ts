import { OAuth2Client } from "google-auth-library";

export type GoogleProfile = {
  email: string;
  name: string;
  picture?: string;
  emailVerified?: boolean;
};

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/** JWT ID tokens have three base64 segments; OAuth access tokens do not. */
export function looksLikeGoogleIdToken(credential: string): boolean {
  return credential.split(".").length === 3;
}

function requireGoogleClientId(): string {
  const audience = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!audience) {
    throw new Error("GOOGLE_CLIENT_ID is not configured on the server.");
  }
  return audience;
}

/**
 * Resolve a Google profile from either:
 * - an ID token (JWT) verified with GOOGLE_CLIENT_ID, or
 * - an OAuth access token whose audience is verified via tokeninfo
 */
export async function resolveGoogleProfile(
  credential: string
): Promise<GoogleProfile> {
  const audience = requireGoogleClientId();

  if (looksLikeGoogleIdToken(credential)) {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new Error("Invalid Google ID token payload.");
    }
    const emailVerified = payload.email_verified !== false;
    if (!emailVerified) {
      throw new Error("Google email is not verified.");
    }
    return {
      email: payload.email,
      name: payload.name || "Google User",
      picture: payload.picture,
      emailVerified: true,
    };
  }

  // Access-token path: verify the token was issued for THIS app (audience).
  const tokenInfoUrl = new URL("https://oauth2.googleapis.com/tokeninfo");
  tokenInfoUrl.searchParams.set("access_token", credential);

  const tokenInfoResponse = await fetch(tokenInfoUrl.toString());
  if (!tokenInfoResponse.ok) {
    throw new Error("Invalid Google access token.");
  }

  const tokenInfo = (await tokenInfoResponse.json()) as {
    aud?: string;
    azp?: string;
    exp?: string;
    error?: string;
  };

  if (tokenInfo.error) {
    throw new Error("Invalid Google access token.");
  }

  const tokenAudience = tokenInfo.aud || tokenInfo.azp;
  if (!tokenAudience || tokenAudience !== audience) {
    throw new Error("Google access token audience mismatch.");
  }

  if (tokenInfo.exp) {
    const expMs = Number(tokenInfo.exp) * 1000;
    if (Number.isFinite(expMs) && expMs < Date.now()) {
      throw new Error("Google access token has expired.");
    }
  }

  const userInfoResponse = await fetch(
    "https://www.googleapis.com/oauth2/v3/userinfo",
    {
      headers: { Authorization: `Bearer ${credential}` },
    }
  );

  if (!userInfoResponse.ok) {
    throw new Error("Invalid Google access token.");
  }

  const payload = (await userInfoResponse.json()) as {
    email?: string;
    name?: string;
    picture?: string;
    email_verified?: boolean | string;
  };

  if (!payload.email) {
    throw new Error("Invalid Google token payload.");
  }

  const emailVerified =
    payload.email_verified === true || payload.email_verified === "true";
  if (!emailVerified) {
    throw new Error("Google email is not verified.");
  }

  return {
    email: payload.email,
    name: payload.name || "Google User",
    picture: payload.picture,
    emailVerified: true,
  };
}
