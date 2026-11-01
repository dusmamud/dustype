import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pickRandomWords } from "@dustype/util";
import { typingResultSchema, wordsQuerySchema } from "@dustype/schemas";
import { WORDS } from "./words.js";
import {
  hashPassword,
  loginSchema,
  publicUser,
  registerSchema,
  signToken,
  verifyPassword,
} from "./auth.js";
import { createResultStore, type StoredResult } from "./dal/results.js";
import { createUserStore, DuplicateEmailError } from "./dal/users.js";
import { optionalAuth, requireAuth } from "./middleware/auth.js";
import {
  AUTH_RATE_LIMIT,
  RESULTS_RATE_LIMIT,
  createRateLimiter,
} from "./middleware/rateLimit.js";
import { computeBests, toLeaderboardEntries } from "./services/bests.js";
import {
  duplicateOwnerKey,
  ResultDuplicateTracker,
  validateResultSanity,
} from "./validation/results.js";

export type { StoredResult };

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  // Phase 2 stores: Mongo (dustype_users / dustype_results) when
  // DB_URI is set, in-memory fallback otherwise. The DAL resolves
  // the connection lazily, so creating the app never touches a DB.
  const users = createUserStore();
  const results = createResultStore();

  // Phase 3: fresh limiter + duplicate-tracker instances per app,
  // so tests and separate app instances never share counters.
  // Auth limiter keys by IP (no user id exists yet at login time);
  // results limiter keys by user id when optionalAuth set one,
  // else by IP (see middleware/rateLimit.ts).
  const authLimiter = createRateLimiter(AUTH_RATE_LIMIT);
  const resultsLimiter = createRateLimiter(RESULTS_RATE_LIMIT);
  const duplicateTracker = new ResultDuplicateTracker();

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "dustype-backend" });
  });

  app.get("/api/words", (req, res) => {
    const parsed = wordsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid count" });
      return;
    }
    res.json({ words: pickRandomWords(WORDS, parsed.data.count) });
  });

  app.post("/api/auth/register", authLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid registration" });
      return;
    }
    try {
      const created = await users.create({
        email: parsed.data.email,
        displayName: parsed.data.displayName ?? null,
        passwordHash: hashPassword(parsed.data.password),
      });
      res.status(201).json({ user: publicUser(created), token: signToken(created.id) });
    } catch (error) {
      if (error instanceof DuplicateEmailError) {
        res.status(409).json({ error: "Email already registered" });
        return;
      }
      throw error;
    }
  });

  app.post("/api/auth/login", authLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid login" });
      return;
    }
    const found = await users.findByEmail(parsed.data.email);
    // Generic message either way: never reveal whether the email exists.
    if (!found || !verifyPassword(parsed.data.password, found.passwordHash)) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }
    res.json({ user: publicUser(found), token: signToken(found.id) });
  });

  app.get("/api/me", requireAuth, async (req, res) => {
    const found = await users.findById(req.userId ?? "");
    if (!found) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    // publicUser() allow-lists fields: the password hash is never returned.
    res.json({ user: publicUser(found) });
  });

  // Phase 3: personal bests, computed from the owner's existing
  // results via the ResultStore. No new collection is required.
  app.get("/api/users/me/bests", requireAuth, async (req, res) => {
    const list = await results.listByOwner(req.userId ?? "", 500);
    res.json({ bests: computeBests(list) });
  });

  // Phase 3: public leaderboard, top results by WPM.
  // Entries contain ONLY displayName + wpm + accuracy + mode
  // (see services/bests.ts): never email, ownerId, or a hash.
  // Phase 3 displayName is always "anonymous" because StoredResult
  // does not carry a displayName yet; wiring that is Phase 4.
  app.get("/api/leaderboards", async (req, res) => {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw)
      ? Math.min(50, Math.max(1, Math.floor(raw)))
      : 20;
    const list = await results.listAll(limit);
    res.json({ leaderboard: toLeaderboardEntries(list) });
  });

  app.post("/api/results", optionalAuth, resultsLimiter, async (req, res) => {
    const parsed = typingResultSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid result" });
      return;
    }
    // Phase 3 sanity checks run BEFORE storing, and a rejected
    // result is never stored. The shared Zod schema is unchanged.
    const sanityError = validateResultSanity(parsed.data);
    if (sanityError) {
      res.status(400).json({ error: sanityError });
      return;
    }
    // Duplicate check: same owner/IP + same payload within 60s.
    // Anonymous duplicates are keyed by IP + payload.
    const ownerKey = duplicateOwnerKey(req.userId ?? null, req.ip);
    if (duplicateTracker.checkAndRecord(ownerKey, parsed.data)) {
      res.status(400).json({ error: "Duplicate result" });
      return;
    }
    // Ownership comes only from the verified token — never from any
    // client-supplied user id (the schema strips unknown fields anyway).
    // Phase 2 backwards compat: anonymous submissions are still
    // allowed and stored with ownerId null.
    const stored = await results.create({
      ...parsed.data,
      ownerId: req.userId ?? null,
    });
    res.status(201).json({ id: stored.id });
  });

  app.get("/api/results", optionalAuth, async (req, res) => {
    // Token present -> only that user's results. Anonymous -> only
    // recent anonymous results (Phase 1 behaviour, now owner-scoped).
    const list = req.userId
      ? await results.listByOwner(req.userId)
      : await results.listAnonymous();
    res.json({ results: list });
  });

  return app;
}
