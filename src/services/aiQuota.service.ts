/**
 * Persistent, atomic AI usage quotas (MongoDB).
 *
 * Limits (UTC calendar boundaries):
 * - Global month: 10,000 accepted AI requests
 * - Per-user month: 100 accepted AI requests
 * - Global day: AI_GLOBAL_DAILY_LIMIT (default 50)
 *
 * One accepted user message that triggers one model request = one unit.
 * Reserve before contacting OpenRouter; release on provider failure.
 */

import { Types } from "mongoose";
import { AiUsageCounter, AiUsageScope } from "../models/AiUsageCounter";
import { logger } from "../utils/logger";

export const GLOBAL_MONTHLY_LIMIT = 10_000;
export const USER_MONTHLY_LIMIT = 100;

export function getGlobalDailyLimit(): number {
  const raw = Number(process.env.AI_GLOBAL_DAILY_LIMIT);
  if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
  return 50;
}

export function utcMonthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7); // YYYY-MM
}

export function utcDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

export type QuotaDenialReason =
  | "global_daily"
  | "global_monthly"
  | "user_monthly"
  | "database";

export interface QuotaReservation {
  dayPeriodKey: string;
  monthPeriodKey: string;
  userPeriodKey: string;
  userId: string;
}

export type ReserveResult =
  | { ok: true; reservation: QuotaReservation }
  | { ok: false; reason: QuotaDenialReason; message: string };

const FRIENDLY: Record<QuotaDenialReason, string> = {
  global_daily:
    "Our free AI chat has reached today's capacity. Please try again tomorrow.",
  global_monthly:
    "Our free AI chat has reached this month's capacity. Please try again next month.",
  user_monthly:
    "You've reached your monthly free chat limit. Please try again next month.",
  database:
    "We're having trouble checking chat availability right now. Please try again shortly.",
};

async function tryIncrement(
  scope: AiUsageScope,
  periodKey: string,
  limit: number,
  userId?: string
): Promise<boolean> {
  const filter = { scope, periodKey, count: { $lt: limit } };
  const update: Record<string, unknown> = {
    $inc: { count: 1 },
  };
  if (userId) {
    update.$setOnInsert = { userId: new Types.ObjectId(userId) };
  }

  try {
    const doc = await AiUsageCounter.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
    });
    return Boolean(doc);
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    // Concurrent first-insert race: unique index conflict → retry without upsert
    if (code === 11000) {
      const retry = await AiUsageCounter.findOneAndUpdate(
        filter,
        { $inc: { count: 1 } },
        { new: true }
      );
      return Boolean(retry);
    }
    throw err;
  }
}

async function decrement(
  scope: AiUsageScope,
  periodKey: string
): Promise<void> {
  await AiUsageCounter.findOneAndUpdate(
    { scope, periodKey, count: { $gt: 0 } },
    { $inc: { count: -1 } }
  );
}

/**
 * Atomically reserve one unit across day, global month, and user month.
 * Rolls back earlier increments if a later counter is exhausted.
 */
export async function reserveQuota(userId: string): Promise<ReserveResult> {
  const dayPeriodKey = utcDayKey();
  const monthPeriodKey = utcMonthKey();
  const userPeriodKey = `${userId}:${monthPeriodKey}`;
  const dailyLimit = getGlobalDailyLimit();

  try {
    const dayOk = await tryIncrement(
      "global_day",
      dayPeriodKey,
      dailyLimit
    );
    if (!dayOk) {
      return {
        ok: false,
        reason: "global_daily",
        message: FRIENDLY.global_daily,
      };
    }

    const monthOk = await tryIncrement(
      "global_month",
      monthPeriodKey,
      GLOBAL_MONTHLY_LIMIT
    );
    if (!monthOk) {
      await decrement("global_day", dayPeriodKey);
      return {
        ok: false,
        reason: "global_monthly",
        message: FRIENDLY.global_monthly,
      };
    }

    const userOk = await tryIncrement(
      "user_month",
      userPeriodKey,
      USER_MONTHLY_LIMIT,
      userId
    );
    if (!userOk) {
      await decrement("global_day", dayPeriodKey);
      await decrement("global_month", monthPeriodKey);
      return {
        ok: false,
        reason: "user_monthly",
        message: FRIENDLY.user_monthly,
      };
    }

    return {
      ok: true,
      reservation: {
        dayPeriodKey,
        monthPeriodKey,
        userPeriodKey,
        userId,
      },
    };
  } catch (err) {
    logger.error("AI quota reservation failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      reason: "database",
      message: FRIENDLY.database,
    };
  }
}

/** Release a reservation after provider failure (before a usable reply). */
export async function releaseQuota(
  reservation: QuotaReservation
): Promise<void> {
  try {
    await Promise.all([
      decrement("global_day", reservation.dayPeriodKey),
      decrement("global_month", reservation.monthPeriodKey),
      decrement("user_month", reservation.userPeriodKey),
    ]);
  } catch (err) {
    logger.error("AI quota release failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function friendlyQuotaMessage(reason: QuotaDenialReason): string {
  return FRIENDLY[reason];
}

/** Test/helper: read counter value (0 if missing). */
export async function getCounterCount(
  scope: AiUsageScope,
  periodKey: string
): Promise<number> {
  const doc = await AiUsageCounter.findOne({ scope, periodKey }).lean();
  return doc?.count ?? 0;
}
