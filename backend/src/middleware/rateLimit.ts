import type { NextFunction, Request, Response } from "express";

// Own in-memory rate limiter, written for dustype Phase 3.
// Deliberately no new dependency: the Phase 2 stack already had
// express-rate-limit in the reference project, but adding a dep
// here would risk the VM's pnpm chown quirk blocking verification,
// and a small fixed-window limiter is sufficient for Phase 3.
// Caveat, documented in example.env: state lives in memory only,
// so a restart resets all counters, and counters are per-process
// (not shared across multiple backend instances).

export interface RateLimitOptions {
  /** Window in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per key inside one window. */
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

function rateLimitKey(req: Request): string {
  // Authenticated user id wins when present (optionalAuth runs
  // before this middleware on /api/results). Otherwise fall back
  // to IP, so anonymous abuse is still limited per address.
  if (req.userId) return `user:${req.userId}`;
  const ip = req.ip ?? "unknown";
  return `ip:${ip}`;
}

/**
 * Create a fresh limiter instance. Each createApp() call gets its
 * own instances, so tests and separate app instances never share
 * counters.
 */
export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();

  return function rateLimiter(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now();
    const key = rateLimitKey(req);
    const bucket = buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((bucket.resetAt - now) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: "Too many requests, please try again later.",
      });
      return;
    }

    next();
  };
}

// Phase 3 limits, documented in backend/example.env:
// Auth (login/register): 10 attempts per 15 minutes per key.
//   Brute-force / credential-stuffing protection: 10 is enough for
//   a real user who mistypes a few times, but far too slow for
//   automated guessing, and 15 minutes is short enough not to
//   lock a legitimate user out for long.
// Results: 60 submissions per hour per key.
//   A real typing test takes at least ~15 seconds, so 60/hour is
//   generous for a human (one test per minute), but it caps bulk
//   spam / forged-result flooding from one key.
export const AUTH_RATE_LIMIT: RateLimitOptions = {
  windowMs: 15 * 60 * 1000,
  max: 10,
};

export const RESULTS_RATE_LIMIT: RateLimitOptions = {
  windowMs: 60 * 60 * 1000,
  max: 60,
};
