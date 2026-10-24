/**
 * Admin security unit regressions (no live server required).
 * Run: npx ts-node src/__tests__/admin-security.test.ts
 */

import assert from "assert";
import {
  signAdminAccessToken,
  signAdminMfaChallengeToken,
  signAdminResetToken,
  verifyAdminAccessToken,
  verifyAdminMfaChallengeToken,
  verifyAdminResetToken,
} from "../utils/jwt";
import { maskPhone, maskEmail } from "../utils/mask";
import {
  generateMfaSecret,
  verifyTotp,
  generateRecoveryCodes,
  consumeRecoveryCode,
  hashRecoveryCode,
} from "../services/adminMfa.service";
import { authenticator } from "otplib";
import {
  DEFAULT_ADMIN_PERMISSIONS,
  isKnownPermission,
} from "../utils/adminPermissions";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = "test-admin-security-jwt-secret";
  }
  delete process.env.ADMIN_JWT_SECRET;

  console.log("\nAdmin security unit tests\n");

  await test("admin access token verifies; reset/mfa challenge do not", () => {
    const access = signAdminAccessToken("adm1", "admin", 0);
    const claims = verifyAdminAccessToken(access);
    assert.strictEqual(claims.adminId, "adm1");
    assert.strictEqual(claims.typ, "admin_access");

    const reset = signAdminResetToken("adm1");
    assert.throws(() => verifyAdminAccessToken(reset));

    const mfa = signAdminMfaChallengeToken("adm1", 0);
    assert.throws(() => verifyAdminAccessToken(mfa));
    const challenge = verifyAdminMfaChallengeToken(mfa);
    assert.strictEqual(challenge.typ, "admin_mfa_challenge");
  });

  await test("reset token purpose binding", () => {
    const reset = signAdminResetToken("adm1");
    const r = verifyAdminResetToken(reset);
    assert.strictEqual(r.typ, "admin_password_reset");
  });

  await test("TOTP verify round-trip", () => {
    const secret = generateMfaSecret();
    const token = authenticator.generate(secret);
    assert.strictEqual(verifyTotp(token, secret), true);
    assert.strictEqual(verifyTotp("000000", secret), false);
  });

  await test("recovery codes are single-use hashes", () => {
    const { codes, hashes } = generateRecoveryCodes(3);
    assert.strictEqual(codes.length, 3);
    assert.strictEqual(hashes[0], hashRecoveryCode(codes[0]));
    const first = consumeRecoveryCode(codes[0], hashes);
    assert.strictEqual(first.ok, true);
    if (first.ok) {
      const again = consumeRecoveryCode(codes[0], first.remaining);
      assert.strictEqual(again.ok, false);
    }
  });

  await test("phone/email masking", () => {
    assert.strictEqual(maskPhone("+15551234567"), "••••4567");
    assert.match(maskEmail("admin@example.com"), /@example\.com$/);
    assert.ok(!maskEmail("admin@example.com").startsWith("admin@"));
  });

  await test("permission catalog includes consultations.write", () => {
    assert.ok(isKnownPermission("consultations.write"));
    assert.ok(DEFAULT_ADMIN_PERMISSIONS.includes("users.read"));
    assert.ok(!DEFAULT_ADMIN_PERMISSIONS.includes("users.delete"));
  });

  console.log(`\n${passed}/${passed + failed} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
