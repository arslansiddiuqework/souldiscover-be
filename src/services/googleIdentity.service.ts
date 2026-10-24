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

/**
 * Resolve a Google profile from either:
 * - an ID token (JWT) verified with GOOGLE_CLIENT_ID, or
 * - an OAuth access token via Google userinfo
 */
export async function resolveGoogleProfile(
  credential: string
): Promise<GoogleProfile> {
  if (looksLikeGoogleIdToken(credential)) {
    const audience = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!audience) {
      throw new Error("GOOGLE_CLIENT_ID is not configured on the server.");
    }
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new Error("Invalid Google ID token payload.");
    }
    return {
      email: payload.email,
      name: payload.name || "Google User",
      picture: payload.picture,
      emailVerified: payload.email_verified,
    };
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

  return {
    email: payload.email,
    name: payload.name || "Google User",
    picture: payload.picture,
    emailVerified:
      payload.email_verified === true || payload.email_verified === "true",
  };
}
