import type { Request, Response, NextFunction } from "express";

type Bucket = { count: number; resetAt: number };

/**
 * Lightweight in-memory rate limiter.
 * Note: On multi-instance Vercel this is per-instance (best-effort). Prefer
 * an external store for strict global limits later.
 */
function createLimiter(options: {
  windowMs: number;
  max: number;
  keyFn?: (req: Request) => string;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();
  const keyFn =
    options.keyFn ||
    ((req: Request) => {
      const forwarded = req.headers["x-forwarded-for"];
      const ip =
        typeof forwarded === "string"
          ? forwarded.split(",")[0].trim()
          : req.ip || req.socket.remoteAddress || "unknown";
      return ip;
    });

  // Periodic cleanup to avoid unbounded growth
  setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.min(options.windowMs, 60_000)).unref?.();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    res.setHeader("X-RateLimit-Limit", String(options.max));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, options.max - bucket.count))
    );
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      return res.status(429).json({
        message:
          options.message || "Too many requests. Please try again later.",
      });
    }
    next();
  };
}

export const authRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many authentication attempts. Please try again later.",
});

/** Tighter limiter for admin login / MFA (privileged surface). */
export const adminAuthRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: "Too many admin authentication attempts. Please try again later.",
});

export const adminMfaRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many MFA verification attempts. Please try again later.",
});

export const passwordResetRateLimit = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many password reset requests. Please try again later.",
});

export const chatRateLimit = createLimiter({
  windowMs: 60 * 1000,
  max: 20,
  keyFn: (req) => {
    const userId = (req as any).user?._id?.toString?.() || "anon";
    const forwarded = req.headers["x-forwarded-for"];
    const ip =
      typeof forwarded === "string"
        ? forwarded.split(",")[0].trim()
        : req.ip || "unknown";
    return `chat:${userId}:${ip}`;
  },
  message: "Too many chat requests. Please slow down.",
});
