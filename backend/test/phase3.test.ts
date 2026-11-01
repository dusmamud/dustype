import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/middleware/rateLimit";
import {
  ResultDuplicateTracker,
  validateResultSanity,
  type ResultInput,
} from "../src/validation/results";
import { computeBests, toLeaderboardEntries } from "../src/services/bests";

// No server, no DB, no network: pure limiter / validation /
// bests logic only, following the existing auth.test.ts pattern.
// The backend tsconfig includes only src/, so this file in
// backend/test/ is never emitted to dist/.

const validResult: ResultInput = {
  mode: "time",
  wpm: 50,
  rawWpm: 60,
  accuracy: 90,
  correctChars: 250,
  incorrectChars: 25,
  elapsedSeconds: 60,
  wordCount: 50,
};

function mockReq(userId?: string, ip = "127.0.0.1") {
  return { userId, ip } as never;
}

function mockRes() {
  let statusCode = 0;
  let body: unknown = null;
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      statusCode = code;
      return res;
    },
    json(payload: unknown) {
      body = payload;
      return res;
    },
  };
  return {
    res: res as never,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

describe("rate limiter", () => {
  it("blocks after the limit and returns 429 with a JSON error", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    let nextCalls = 0;
    const next = () => {
      nextCalls += 1;
    };
    limiter(mockReq(undefined, "1.2.3.4"), mockRes().res, next);
    limiter(mockReq(undefined, "1.2.3.4"), mockRes().res, next);
    expect(nextCalls).toBe(2);

    const blocked = mockRes();
    limiter(mockReq(undefined, "1.2.3.4"), blocked.res, next);
    expect(nextCalls).toBe(2);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body).toEqual({
      error: "Too many requests, please try again later.",
    });
    expect(blocked.headers["Retry-After"]).toBeDefined();
  });

  it("keys by user id when present, so different users do not share a bucket", () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    let nextCalls = 0;
    const next = () => {
      nextCalls += 1;
    };
    limiter(mockReq("user-a", "9.9.9.9"), mockRes().res, next);
    expect(nextCalls).toBe(1);
    // Same IP, different user: must not be blocked by user-a's bucket.
    limiter(mockReq("user-b", "9.9.9.9"), mockRes().res, next);
    expect(nextCalls).toBe(2);
  });
});

describe("result sanity validation", () => {
  it("rejects an implausibly high WPM", () => {
    const error = validateResultSanity({
      ...validResult,
      wpm: 500,
      rawWpm: 500,
      correctChars: 400,
      incorrectChars: 10,
    });
    expect(error).not.toBeNull();
  });

  it("rejects accuracy below the floor on a substantial sample", () => {
    const error = validateResultSanity({
      ...validResult,
      accuracy: 10,
      correctChars: 10,
      incorrectChars: 90,
    });
    expect(error).not.toBeNull();
  });

  it("rejects elapsed time that is implausibly short for the word count", () => {
    const error = validateResultSanity({
      ...validResult,
      elapsedSeconds: 1,
      wordCount: 50,
    });
    expect(error).not.toBeNull();
  });

  it("passes a valid result", () => {
    expect(validateResultSanity(validResult)).toBeNull();
  });

  it("does not reject a small sample on WPM/accuracy floors alone", () => {
    // 10 chars: below the 50-char substantial threshold, so the
    // WPM/accuracy floors must not fire on noise alone.
    expect(
      validateResultSanity({
        mode: "words",
        wpm: 10,
        rawWpm: 12,
        accuracy: 50,
        correctChars: 5,
        incorrectChars: 5,
        elapsedSeconds: 30,
        wordCount: 10,
      }),
    ).toBeNull();
  });
});

describe("duplicate result detection", () => {
  it("rejects an identical result within the window, and accepts it after the window", () => {
    const tracker = new ResultDuplicateTracker();
    expect(tracker.checkAndRecord("user:u1", validResult, 1_000)).toBe(false);
    expect(tracker.checkAndRecord("user:u1", validResult, 2_000)).toBe(true);
    // Different payload is not a duplicate.
    expect(
      tracker.checkAndRecord("user:u1", { ...validResult, wpm: 51 }, 3_000),
    ).toBe(false);
    // After 60s from the first record, the same payload is fresh again.
    expect(tracker.checkAndRecord("user:u1", validResult, 62_000)).toBe(false);
  });

  it("keys anonymous duplicates by IP, not by a shared anonymous bucket", () => {
    const tracker = new ResultDuplicateTracker();
    expect(tracker.checkAndRecord("ip:1.1.1.1", validResult, 1_000)).toBe(false);
    expect(tracker.checkAndRecord("ip:2.2.2.2", validResult, 2_000)).toBe(false);
  });
});

describe("personal bests and leaderboard shapes", () => {
  it("picks the best WPM per mode and null for a missing mode", () => {
    const bests = computeBests([
      { ...validResult, id: "1", ownerId: "u1", createdAt: "2026-01-01T00:00:00.000Z", mode: "time", wpm: 50 },
      { ...validResult, id: "2", ownerId: "u1", createdAt: "2026-01-01T00:00:00.000Z", mode: "time", wpm: 80, accuracy: 95 },
      { ...validResult, id: "3", ownerId: "u1", createdAt: "2026-01-01T00:00:00.000Z", mode: "words", wpm: 60 },
    ] as never);
    expect(bests.time?.wpm).toBe(80);
    expect(bests.words?.wpm).toBe(60);
    const empty = computeBests([]);
    expect(empty.time).toBeNull();
    expect(empty.words).toBeNull();
  });

  it("leaderboard entries expose only displayName, wpm, accuracy, mode", () => {
    const entries = toLeaderboardEntries([
      { ...validResult, id: "1", ownerId: "secret-owner", createdAt: "2026-01-01T00:00:00.000Z" },
    ] as never);
    expect(entries).toEqual([
      { displayName: "anonymous", wpm: 50, accuracy: 90, mode: "time" },
    ]);
    expect(JSON.stringify(entries)).not.toContain("secret-owner");
  });
});
