/**
 * Security regression tests for JWT purpose binding, password policy, and Cloudinary URL parsing.
 * Run: npx ts-node src/__tests__/security-auth.test.ts
 */

import assert from "assert";
import {
  signUserAccessToken,
  signUserResetToken,
  verifyUserAccessToken,
  verifyUserResetToken,
} from "../utils/jwt";
import { validatePasswordStrength, normalizeEmail } from "../utils/passwordPolicy";
import { getPublicIdFromUrl } from "../services/cloudinary.service";

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

async function main() {
  console.log("\nSecurity auth regression tests\n");

  // Ensure JWT_SECRET for local test (never use production values here)
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "test-only-jwt-secret-for-security-auth";
  }

  await test("password policy rejects short passwords", () => {
    const r = validatePasswordStrength("short");
    assert.strictEqual(r.ok, false);
  });

  await test("password policy accepts strong passwords", () => {
    const r = validatePasswordStrength("Str0ng-Passw0rd!");
    assert.strictEqual(r.ok, true);
  });

  await test("normalizeEmail lowercases and trims", () => {
    assert.strictEqual(normalizeEmail("  Casey@Example.COM "), "casey@example.com");
  });

  await test("access token verifies as access, not as reset", () => {
    const token = signUserAccessToken("user123", 0);
    const access = verifyUserAccessToken(token);
    assert.strictEqual(access.userId, "user123");
    assert.strictEqual(access.typ, "access");
    assert.throws(() => verifyUserResetToken(token));
  });

  await test("reset token cannot be used as access token", () => {
    const token = signUserResetToken("user123");
    const reset = verifyUserResetToken(token);
    assert.strictEqual(reset.userId, "user123");
    assert.strictEqual(reset.typ, "password_reset");
    assert.throws(() => verifyUserAccessToken(token));
  });

  await test("Cloudinary helper rejects lookalike hosts", () => {
    assert.strictEqual(
      getPublicIdFromUrl(
        "https://evil-cloudinary.com/demo/image/upload/v1/folder/file.jpg"
      ),
      null
    );
    assert.strictEqual(
      getPublicIdFromUrl("http://res.cloudinary.com/demo/image/upload/v1/a.jpg"),
      null
    );
  });

  await test("Cloudinary helper accepts res.cloudinary.com HTTPS", () => {
    const id = getPublicIdFromUrl(
      "https://res.cloudinary.com/demo/image/upload/v123/folder/file.jpg"
    );
    assert.ok(id === "folder/file" || id === "folder/file.jpg" || typeof id === "string");
  });

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
