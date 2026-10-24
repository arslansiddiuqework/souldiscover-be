/**
 * Google identity + auth API smoke tests.
 * Run: npx ts-node src/__tests__/google-auth.test.ts
 *
 * Identity tests mock Google tokeninfo + userinfo.
 * HTTP smoke hits local backend when ADMIN/API is up (optional).
 */

import assert from "assert";
import {
  looksLikeGoogleIdToken,
  resolveGoogleProfile,
} from "../services/googleIdentity.service";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${err instanceof Error ? err.message : err}`);
  }
}

const originalFetch = global.fetch;
const TEST_CLIENT_ID = "test-google-client-id.apps.googleusercontent.com";

async function main() {
  console.log("\nGoogle auth tests\n");

  await test("detects Google ID tokens vs access tokens", () => {
    assert.strictEqual(
      looksLikeGoogleIdToken("aaa.bbb.ccc"),
      true,
      "three-part JWT should look like an ID token"
    );
    assert.strictEqual(
      looksLikeGoogleIdToken("ya29.a0AfH6SMC"),
      false,
      "access tokens should not look like ID tokens"
    );
  });

  await test("ID token path requires GOOGLE_CLIENT_ID", async () => {
    const prev = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      await resolveGoogleProfile("header.payload.signature");
      assert.fail("expected throw");
    } catch (err) {
      assert.match(
        err instanceof Error ? err.message : "",
        /GOOGLE_CLIENT_ID/i
      );
    } finally {
      if (prev !== undefined) process.env.GOOGLE_CLIENT_ID = prev;
    }
  });

  await test("access token: requires GOOGLE_CLIENT_ID", async () => {
    const prev = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;
    try {
      await resolveGoogleProfile("ya29.no-client-id");
      assert.fail("expected throw");
    } catch (err) {
      assert.match(
        err instanceof Error ? err.message : "",
        /GOOGLE_CLIENT_ID/i
      );
    } finally {
      if (prev !== undefined) process.env.GOOGLE_CLIENT_ID = prev;
    }
  });

  await test("access token: rejects invalid Google tokeninfo", async () => {
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
    global.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("tokeninfo")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({}),
        } as Response;
      }
      assert.fail(`unexpected fetch: ${url}`);
      return {} as Response;
    }) as typeof fetch;

    try {
      await resolveGoogleProfile("ya29.invalid");
      assert.fail("expected throw");
    } catch (err) {
      assert.match(
        err instanceof Error ? err.message : "",
        /Invalid Google access token/i
      );
    }
  });

  await test("access token: rejects audience mismatch", async () => {
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
    global.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("tokeninfo")) {
        return {
          ok: true,
          json: async () => ({
            aud: "other-app.apps.googleusercontent.com",
            exp: String(Math.floor(Date.now() / 1000) + 3600),
          }),
        } as Response;
      }
      assert.fail(`unexpected fetch: ${url}`);
      return {} as Response;
    }) as typeof fetch;

    try {
      await resolveGoogleProfile("ya29.wrong-aud");
      assert.fail("expected throw");
    } catch (err) {
      assert.match(
        err instanceof Error ? err.message : "",
        /audience mismatch/i
      );
    }
  });

  await test("access token: maps verified tokeninfo + userinfo to profile", async () => {
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
    global.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("tokeninfo")) {
        return {
          ok: true,
          json: async () => ({
            aud: TEST_CLIENT_ID,
            exp: String(Math.floor(Date.now() / 1000) + 3600),
          }),
        } as Response;
      }
      assert.match(url, /oauth2\/v3\/userinfo/);
      return {
        ok: true,
        json: async () => ({
          email: "Casey@Example.com",
          name: "Casey Calm",
          picture: "https://example.com/p.png",
          email_verified: "true",
        }),
      } as Response;
    }) as typeof fetch;

    const profile = await resolveGoogleProfile("ya29.valid-token");
    assert.strictEqual(profile.email, "Casey@Example.com");
    assert.strictEqual(profile.name, "Casey Calm");
    assert.strictEqual(profile.picture, "https://example.com/p.png");
    assert.strictEqual(profile.emailVerified, true);
  });

  await test("access token: requires email in userinfo payload", async () => {
    process.env.GOOGLE_CLIENT_ID = TEST_CLIENT_ID;
    global.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes("tokeninfo")) {
        return {
          ok: true,
          json: async () => ({
            aud: TEST_CLIENT_ID,
            exp: String(Math.floor(Date.now() / 1000) + 3600),
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ name: "No Email", email_verified: true }),
      } as Response;
    }) as typeof fetch;

    try {
      await resolveGoogleProfile("ya29.no-email");
      assert.fail("expected throw");
    } catch (err) {
      assert.match(
        err instanceof Error ? err.message : "",
        /Invalid Google token payload/i
      );
    }
  });

  // Restore real fetch before optional live API smoke.
  global.fetch = originalFetch;

  const { execFileSync } = require("child_process") as typeof import("child_process");

  function curlJson(
    url: string,
    body: Record<string, unknown>
  ): { status: number; body: { message?: string } } {
    const out = execFileSync(
      "curl",
      [
        "-sS",
        "-w",
        "\n__HTTP__%{http_code}",
        "-X",
        "POST",
        url,
        "-H",
        "Content-Type: application/json",
        "--max-time",
        "8",
        "-d",
        JSON.stringify(body),
      ],
      { encoding: "utf8" }
    );
    const parts = out.trim().split("\n__HTTP__");
    const status = Number(parts[1] || "0");
    let parsed: { message?: string } = {};
    try {
      parsed = JSON.parse(parts[0] || "{}");
    } catch {
      parsed = { message: parts[0] };
    }
    return { status, body: parsed };
  }

  // Optional live API smoke (skipped quietly if backend is down)
  const base = process.env.AUTH_API_BASE || "http://127.0.0.1:4001";
  const feBase = process.env.FE_API_BASE || "http://127.0.0.1:3001";
  try {
    const missing = curlJson(`${base}/auth/google`, {});
    await test("live API: missing credential → 400", () => {
      assert.strictEqual(missing.status, 400);
      assert.match(String(missing.body.message || ""), /credential/i);
    });

    const bad = curlJson(`${base}/auth/google`, {
      credential: "ya29.not-a-real-token",
    });
    await test("live API: bad access token → 400", () => {
      assert.strictEqual(bad.status, 400);
      assert.match(
        String(bad.body.message || ""),
        /invalid google access token|google|credential/i
      );
    });

    const proxy = curlJson(`${feBase}/api/auth/google`, {
      credential: "ya29.not-a-real-token",
    });
    await test("live FE proxy: bad token → 400", () => {
      assert.strictEqual(proxy.status, 400);
      assert.ok(proxy.body.message);
    });
  } catch (err) {
    console.log(
      `SKIP  live API smoke (backend/FE not reachable): ${
        err instanceof Error ? err.message : err
      }`
    );
  }

  global.fetch = originalFetch;
  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  global.fetch = originalFetch;
  console.error(err);
  process.exit(2);
});
