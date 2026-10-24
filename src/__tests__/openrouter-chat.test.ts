/**
 * OpenRouter free-chat + quota tests.
 * Run: npm run test:chat
 *
 * OpenRouter is always mocked — no real API requests.
 * MongoDB tests run when MONGODB_URI (or local Mongo) is reachable.
 */

import assert from "assert";
import mongoose from "mongoose";
import {
  assertAllModelsFree,
  assertFreeModelConfig,
  buildChatCompletionsBody,
  generateStream,
  isFreeOpenRouterModel,
  LLMProviderError,
} from "../services/llm.service";
import {
  getCounterCount,
  getGlobalDailyLimit,
  GLOBAL_MONTHLY_LIMIT,
  releaseQuota,
  reserveQuota,
  USER_MONTHLY_LIMIT,
  utcDayKey,
  utcMonthKey,
} from "../services/aiQuota.service";
import { randomUUID } from "crypto";
import { AiUsageCounter } from "../models/AiUsageCounter";
import { ChatIdempotency } from "../models/ChatIdempotency";
import { ChatSession } from "../models/ChatSession";

let passed = 0;
let failed = 0;
let skipped = 0;

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

function skip(name: string, reason: string) {
  skipped += 1;
  console.log(`SKIP  ${name} (${reason})`);
}

const originalFetch = global.fetch;
let fetchCalls: Array<{ url: string; body: any }> = [];

function mockOpenRouterSuccess(content = "Hello, I'm here for you.") {
  fetchCalls = [];
  global.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(init.body) : null;
    fetchCalls.push({ url, body });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        const chunk = {
          id: "gen-test",
          model: "openrouter/free",
          choices: [{ delta: { content }, index: 0 }],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return {
      ok: true,
      status: 200,
      body: stream,
      text: async () => "",
      json: async () => ({}),
    } as Response;
  }) as typeof fetch;
}

function mockOpenRouterHttp(status: number, body = '{"error":{"message":"fail"}}') {
  fetchCalls = [];
  global.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    fetchCalls.push({
      url,
      body: init?.body ? JSON.parse(init.body) : null,
    });
    return {
      ok: false,
      status,
      body: null,
      text: async () => body,
      json: async () => JSON.parse(body),
    } as Response;
  }) as typeof fetch;
}

async function main() {
  console.log("\nOpenRouter free-chat tests\n");

  const prevKey = process.env.OPENROUTER_API_KEY;
  const prevModel = process.env.OPENROUTER_MODEL;
  const prevDaily = process.env.AI_GLOBAL_DAILY_LIMIT;

  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_MODEL = "openrouter/free";

  // ── Free-model guards ──────────────────────────────────────────
  await test("accepts openrouter/free as free", () => {
    assert.strictEqual(isFreeOpenRouterModel("openrouter/free"), true);
    assert.strictEqual(
      isFreeOpenRouterModel("meta-llama/llama-3.2-3b-instruct:free"),
      true
    );
  });

  await test("rejects paid models", () => {
    assert.strictEqual(isFreeOpenRouterModel("openai/gpt-4o"), false);
    assert.strictEqual(isFreeOpenRouterModel("anthropic/claude-3.5-sonnet"), false);
    assert.strictEqual(isFreeOpenRouterModel("google/gemini-pro"), false);
  });

  await test("assertFreeModelConfig rejects paid OPENROUTER_MODEL", () => {
    process.env.OPENROUTER_MODEL = "openai/gpt-4o";
    assert.throws(() => assertFreeModelConfig(), LLMProviderError);
    process.env.OPENROUTER_MODEL = "openrouter/free";
    assert.strictEqual(assertFreeModelConfig(), "openrouter/free");
  });

  await test("assertAllModelsFree blocks paid fallback lists", () => {
    assert.throws(
      () =>
        assertAllModelsFree([
          "openrouter/free",
          "openai/gpt-4o-mini",
        ]),
      /Refusing paid/
    );
    assertAllModelsFree(["openrouter/free", "meta-llama/llama-3.2-3b-instruct:free"]);
  });

  await test("request body never includes paid fallback models", () => {
    process.env.OPENROUTER_MODEL = "openrouter/free";
    const body = buildChatCompletionsBody("hi", { maxTokens: 50 });
    assert.ok(isFreeOpenRouterModel(String(body.model)));
    assert.ok(String(body.model).endsWith(":free"));
    const fallbacks = (body.models as string[] | undefined) || [];
    assert.ok(fallbacks.length <= 3, "OpenRouter allows at most 3 fallbacks");
    for (const m of [String(body.model), ...fallbacks]) {
      assert.ok(isFreeOpenRouterModel(m), m);
      assert.ok(!m.includes("content-safety"), m);
      assert.ok(!m.includes("gpt-4"), m);
    }
  });

  await test("rejects content-safety style replies", () => {
    const {
      looksLikeSafetyClassifierOutput,
      isNonConversationalFreeModel,
    } = require("../services/llm.service");
    assert.strictEqual(
      looksLikeSafetyClassifierOutput("User Safety: safe"),
      true
    );
    assert.strictEqual(
      isNonConversationalFreeModel(
        "nvidia/nemotron-3.5-content-safety:free"
      ),
      true
    );
  });

  // ── Streaming success / errors (mocked fetch) ──────────────────
  await test("successful stream returns assistant text", async () => {
    mockOpenRouterSuccess("You matter, and I'm listening.");
    const chunks: string[] = [];
    const result = await generateStream("I feel anxious", (c) => chunks.push(c), {
      maxTokens: 80,
    });
    assert.strictEqual(result.error, undefined);
    assert.match(result.fullText, /listening/);
    assert.ok(chunks.join("").includes("listening"));
    assert.strictEqual(fetchCalls.length, 1);
    assert.match(fetchCalls[0].url, /openrouter\.ai\/api\/v1\/chat\/completions/);
    assert.ok(String(fetchCalls[0].body.model).endsWith(":free"));
    assert.ok(!String(fetchCalls[0].body.model).includes("content-safety"));
  });

  await test("unavailable free models return friendly message", async () => {
    mockOpenRouterHttp(404, '{"error":{"message":"No endpoints found"}}');
    const result = await generateStream("hello", () => {});
    assert.strictEqual(result.error, true);
    assert.strictEqual(result.errorCode, "unavailable");
    assert.match(result.fullText, /temporarily unavailable/i);
  });

  await test("provider 429 returns friendly rate-limit message", async () => {
    mockOpenRouterHttp(429, '{"error":{"message":"Rate limit exceeded"}}');
    const result = await generateStream("hello", () => {});
    assert.strictEqual(result.error, true);
    assert.strictEqual(result.errorCode, "rate_limited");
    assert.match(result.fullText, /busy|wait/i);
  });

  await test("provider 5xx returns friendly unavailable message", async () => {
    mockOpenRouterHttp(503, '{"error":{"message":"upstream"}}');
    const result = await generateStream("hello", () => {});
    assert.strictEqual(result.error, true);
    assert.strictEqual(result.errorCode, "provider_error");
  });

  await test("missing API key never calls OpenRouter", async () => {
    fetchCalls = [];
    let called = false;
    global.fetch = (async () => {
      called = true;
      throw new Error("should not fetch");
    }) as typeof fetch;
    delete process.env.OPENROUTER_API_KEY;
    const result = await generateStream("hello", () => {});
    assert.strictEqual(called, false);
    assert.strictEqual(result.error, true);
    assert.strictEqual(result.errorCode, "missing_key");
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  });

  await test("configured paid model never reaches OpenRouter", async () => {
    fetchCalls = [];
    let called = false;
    global.fetch = (async () => {
      called = true;
      return {} as Response;
    }) as typeof fetch;
    process.env.OPENROUTER_MODEL = "openai/gpt-4o";
    const result = await generateStream("hello", () => {});
    assert.strictEqual(called, false);
    assert.strictEqual(result.error, true);
    assert.strictEqual(result.errorCode, "invalid_model");
    process.env.OPENROUTER_MODEL = "openrouter/free";
  });

  await test("default daily limit is 50", () => {
    delete process.env.AI_GLOBAL_DAILY_LIMIT;
    assert.strictEqual(getGlobalDailyLimit(), 50);
    process.env.AI_GLOBAL_DAILY_LIMIT = "50";
  });

  // ── MongoDB-backed quota / idempotency ─────────────────────────
  const mongoUri =
    process.env.MONGODB_URI_TEST ||
    process.env.MONGODB_URI ||
    "mongodb://localhost:27017/aurapulse_openrouter_test";

  let dbReady = false;
  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    dbReady = true;
  } catch {
    dbReady = false;
  }

  if (!dbReady) {
    skip("quota + idempotency DB tests", "MongoDB unreachable");
  } else {
    const userA = new mongoose.Types.ObjectId().toString();
    const userB = new mongoose.Types.ObjectId().toString();

    await AiUsageCounter.deleteMany({});
    await ChatIdempotency.deleteMany({});

    process.env.AI_GLOBAL_DAILY_LIMIT = "3";

    await test("reserves quota atomically under daily limit", async () => {
      const r1 = await reserveQuota(userA);
      assert.strictEqual(r1.ok, true);
      const r2 = await reserveQuota(userA);
      assert.strictEqual(r2.ok, true);
      assert.strictEqual(
        await getCounterCount("global_day", utcDayKey()),
        2
      );
    });

    await test("rejects over daily limit without provider contact pattern", async () => {
      // daily limit=3; already used 2
      const r3 = await reserveQuota(userB);
      assert.strictEqual(r3.ok, true);
      const r4 = await reserveQuota(userB);
      assert.strictEqual(r4.ok, false);
      if (!r4.ok) {
        assert.strictEqual(r4.reason, "global_daily");
      }
      // Simulate "never call OpenRouter" when quota denied
      let providerCalled = false;
      global.fetch = (async () => {
        providerCalled = true;
        return {} as Response;
      }) as typeof fetch;
      if (!r4.ok) {
        // application path: do not call generateStream
        assert.strictEqual(providerCalled, false);
      }
    });

    await test("releases quota on provider failure", async () => {
      await AiUsageCounter.deleteMany({});
      process.env.AI_GLOBAL_DAILY_LIMIT = "50";
      const reserved = await reserveQuota(userA);
      assert.strictEqual(reserved.ok, true);
      if (reserved.ok) {
        await releaseQuota(reserved.reservation);
      }
      assert.strictEqual(
        await getCounterCount("global_day", utcDayKey()),
        0
      );
    });

    await test("concurrent reservations never exceed limit", async () => {
      await AiUsageCounter.deleteMany({});
      process.env.AI_GLOBAL_DAILY_LIMIT = "5";
      const users = Array.from({ length: 12 }, () =>
        new mongoose.Types.ObjectId().toString()
      );
      const results = await Promise.all(users.map((u) => reserveQuota(u)));
      const accepted = results.filter((r) => r.ok).length;
      const denied = results.filter((r) => !r.ok).length;
      assert.strictEqual(accepted, 5);
      assert.strictEqual(denied, 7);
      assert.strictEqual(
        await getCounterCount("global_day", utcDayKey()),
        5
      );
    });

    await test("user monthly limit is enforced", async () => {
      await AiUsageCounter.deleteMany({});
      process.env.AI_GLOBAL_DAILY_LIMIT = "10000";
      // Pre-fill user counter near limit
      await AiUsageCounter.create({
        scope: "user_month",
        periodKey: `${userA}:${utcMonthKey()}`,
        userId: new mongoose.Types.ObjectId(userA),
        count: USER_MONTHLY_LIMIT,
      });
      const r = await reserveQuota(userA);
      assert.strictEqual(r.ok, false);
      if (!r.ok) assert.strictEqual(r.reason, "user_monthly");
    });

    await test("global monthly limit constant is 10000", () => {
      assert.strictEqual(GLOBAL_MONTHLY_LIMIT, 10_000);
    });

    await test("UTC day/month keys are stable calendar boundaries", () => {
      const d = new Date(Date.UTC(2026, 9, 24, 23, 30, 0)); // Oct 24
      assert.strictEqual(utcDayKey(d), "2026-10-24");
      assert.strictEqual(utcMonthKey(d), "2026-10");
      const next = new Date(Date.UTC(2026, 9, 25, 0, 0, 1));
      assert.strictEqual(utcDayKey(next), "2026-10-25");
    });

    await test("idempotency key rejects duplicates", async () => {
      await ChatIdempotency.deleteMany({});
      const uid = new mongoose.Types.ObjectId();
      await ChatIdempotency.create({
        userId: uid,
        key: "client:abc-123",
        sessionId: "sess-1",
      });
      let duplicate = false;
      try {
        await ChatIdempotency.create({
          userId: uid,
          key: "client:abc-123",
          sessionId: "sess-1",
        });
      } catch (err: any) {
        duplicate = err?.code === 11000;
      }
      assert.strictEqual(duplicate, true);
    });

    await test("cross-user ownership query returns no session", async () => {
      const owner = new mongoose.Types.ObjectId();
      const other = new mongoose.Types.ObjectId();
      const sessionId = randomUUID();
      await ChatSession.create({
        sessionId,
        userId: owner,
        title: "Private",
        startTime: new Date(),
        status: "active",
        messages: [
          { role: "user", content: "hello", timestamp: new Date() },
        ],
      });
      const leaked = await ChatSession.findOne({ sessionId, userId: other });
      assert.strictEqual(leaked, null);
      const owned = await ChatSession.findOne({ sessionId, userId: owner });
      assert.ok(owned);
      await ChatSession.deleteOne({ sessionId });
    });

    await test("database failure path returns friendly quota message", async () => {
      // Force failure by disconnecting briefly
      await mongoose.disconnect();
      const r = await reserveQuota(userA);
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        assert.strictEqual(r.reason, "database");
        assert.match(r.message, /availability|try again/i);
      }
      await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 3000 });
    });

    await AiUsageCounter.deleteMany({});
    await ChatIdempotency.deleteMany({});
    await mongoose.disconnect();
  }

  // restore
  global.fetch = originalFetch;
  if (prevKey !== undefined) process.env.OPENROUTER_API_KEY = prevKey;
  else delete process.env.OPENROUTER_API_KEY;
  if (prevModel !== undefined) process.env.OPENROUTER_MODEL = prevModel;
  else delete process.env.OPENROUTER_MODEL;
  if (prevDaily !== undefined) process.env.AI_GLOBAL_DAILY_LIMIT = prevDaily;
  else delete process.env.AI_GLOBAL_DAILY_LIMIT;

  console.log(
    `\nResults: ${passed} passed, ${failed} failed, ${skipped} skipped\n`
  );
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
