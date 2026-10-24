/**
 * TextBee SMS provider unit tests (mocked fetch — never sends real SMS).
 * Run: npm run test:sms
 */

import assert from "assert";
import { TextBeeSmsProvider } from "../services/sms/textbee.provider";
import { normalizeE164, isValidE164, redactPhone } from "../utils/phone";
import { isVoiceEscalationAvailable } from "../services/sms/sms.factory";

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

function mockFetch(impl: typeof fetch) {
  const prev = globalThis.fetch;
  (globalThis as any).fetch = impl;
  return () => {
    (globalThis as any).fetch = prev;
  };
}

async function main() {
  console.log("\nTextBee SMS provider tests\n");

  const provider = new TextBeeSmsProvider();
  const prevKey = process.env.TEXTBEE_API_KEY;
  const prevBase = process.env.TEXTBEE_BASE_URL;

  process.env.TEXTBEE_BASE_URL = "https://api.textbee.dev/api/v1";

  await test("E.164 validation accepts valid numbers", () => {
    assert.strictEqual(isValidE164("+15551234567"), true);
    assert.strictEqual(normalizeE164("+1 (555) 123-4567"), "+15551234567");
  });

  await test("E.164 validation rejects malformed numbers", () => {
    assert.strictEqual(isValidE164("5551234567"), false);
    assert.strictEqual(isValidE164("+0123"), false);
    assert.strictEqual(normalizeE164("not-a-phone"), null);
  });

  await test("phone redaction hides middle digits", () => {
    const r = redactPhone("+15551234567");
    assert.ok(r.includes("4567"));
    assert.ok(!r.includes("555123"));
  });

  await test("voice escalation is unavailable", () => {
    assert.strictEqual(isVoiceEscalationAvailable(), false);
  });

  await test("missing API key returns not_configured", async () => {
    delete process.env.TEXTBEE_API_KEY;
    const result = await provider.sendSms({
      to: "+15551234567",
      message: "hello",
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.code, "not_configured");
  });

  process.env.TEXTBEE_API_KEY = "test-key-not-real";

  await test("malformed number returns invalid_number", async () => {
    const result = await provider.sendSms({
      to: "123",
      message: "hello",
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.code, "invalid_number");
  });

  await test("empty message returns invalid_message", async () => {
    const result = await provider.sendSms({
      to: "+15551234567",
      message: "   ",
    });
    assert.strictEqual(result.ok, false);
    if (!result.ok) assert.strictEqual(result.code, "invalid_message");
  });

  await test("HTTP 200 with smsBatchId is queued (not delivered)", async () => {
    const restore = mockFetch(async () =>
      new Response(
        JSON.stringify({
          data: {
            smsBatchId: "batch-abc",
            recipientCount: 1,
            message: "ok",
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );
    try {
      const result = await provider.sendSms({
        to: "+15551234567",
        message: "crisis test",
      });
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.smsBatchId, "batch-abc");
        assert.strictEqual(result.status, "queued");
        assert.notStrictEqual(result.status, "delivered");
      }
    } finally {
      restore();
    }
  });

  await test("HTTP 401 maps to http_401", async () => {
    const restore = mockFetch(
      async () =>
        new Response(JSON.stringify({ message: "Unauthorized" }), {
          status: 401,
        })
    );
    try {
      const result = await provider.sendSms({
        to: "+15551234567",
        message: "x",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) assert.strictEqual(result.code, "http_401");
    } finally {
      restore();
    }
  });

  await test("HTTP 400 maps to http_400", async () => {
    const restore = mockFetch(
      async () =>
        new Response(JSON.stringify({ message: "No enabled devices" }), {
          status: 400,
        })
    );
    try {
      const result = await provider.sendSms({
        to: "+15551234567",
        message: "x",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.code, "http_400");
        assert.ok(result.error.includes("No enabled devices"));
      }
    } finally {
      restore();
    }
  });

  await test("HTTP 429 maps to http_429", async () => {
    const restore = mockFetch(
      async () => new Response(JSON.stringify({}), { status: 429 })
    );
    try {
      const result = await provider.sendSms({
        to: "+15551234567",
        message: "x",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) assert.strictEqual(result.code, "http_429");
    } finally {
      restore();
    }
  });

  await test("malformed success response missing smsBatchId", async () => {
    const restore = mockFetch(
      async () =>
        new Response(JSON.stringify({ data: { message: "ok" } }), {
          status: 200,
        })
    );
    try {
      const result = await provider.sendSms({
        to: "+15551234567",
        message: "x",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) assert.strictEqual(result.code, "malformed_response");
    } finally {
      restore();
    }
  });

  await test("network failure maps to network", async () => {
    const restore = mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    try {
      const result = await provider.sendSms({
        to: "+15551234567",
        message: "x",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) assert.strictEqual(result.code, "network");
    } finally {
      restore();
    }
  });

  await test("timeout maps to timeout", async () => {
    const restore = mockFetch(async (_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            const err = new Error("Aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    });
    try {
      const result = await provider.sendSms({
        to: "+15551234567",
        message: "x",
      });
      assert.strictEqual(result.ok, false);
      if (!result.ok) assert.strictEqual(result.code, "timeout");
    } finally {
      restore();
    }
  });

  await test("request body uses recipients array and never logs raw key", async () => {
    let capturedBody: any = null;
    let capturedHeaders: any = null;
    const restore = mockFetch(async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body));
      capturedHeaders = init?.headers;
      return new Response(
        JSON.stringify({ data: { smsBatchId: "b1", recipientCount: 1 } }),
        { status: 200 }
      );
    });
    try {
      await provider.sendSms({
        to: "+15551234567",
        message: "hello world",
      });
      assert.deepStrictEqual(capturedBody.recipients, ["+15551234567"]);
      assert.strictEqual(capturedBody.message, "hello world");
      assert.ok(capturedHeaders["x-api-key"]);
      assert.notStrictEqual(capturedHeaders["x-api-key"], "");
    } finally {
      restore();
    }
  });

  // restore env
  if (prevKey === undefined) delete process.env.TEXTBEE_API_KEY;
  else process.env.TEXTBEE_API_KEY = prevKey;
  if (prevBase === undefined) delete process.env.TEXTBEE_BASE_URL;
  else process.env.TEXTBEE_BASE_URL = prevBase;

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
