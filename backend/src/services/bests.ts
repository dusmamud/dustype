import type { StoredResult } from "../dal/results.js";

// Pure bests / leaderboard helpers for dustype Phase 3.
// No DB access here: the app fetches results via the existing
// ResultStore and these functions compute the response shapes.
// That keeps them trivially testable and keeps the leaderboard
// response free of any sensitive fields by construction.

export interface BestEntry {
  wpm: number;
  accuracy: number;
  elapsedSeconds: number;
  wordCount: number;
}

export interface PersonalBests {
  time: BestEntry | null;
  words: BestEntry | null;
}

export function computeBests(results: StoredResult[]): PersonalBests {
  const bests: PersonalBests = { time: null, words: null };
  for (const r of results) {
    const current = bests[r.mode];
    if (!current || r.wpm > current.wpm) {
      bests[r.mode] = {
        wpm: r.wpm,
        accuracy: r.accuracy,
        elapsedSeconds: r.elapsedSeconds,
        wordCount: r.wordCount,
      };
    }
  }
  return bests;
}

export interface LeaderboardEntry {
  displayName: string;
  wpm: number;
  accuracy: number;
  mode: "time" | "words";
}

/**
 * Phase 3 leaderboard entries are always "anonymous": StoredResult
 * does not carry a displayName yet, and the leaderboard must never
 * leak email, ownerId, or a password hash. Wiring a stored
 * displayName onto results is a Phase 4 task (see example.env).
 */
export function toLeaderboardEntries(results: StoredResult[]): LeaderboardEntry[] {
  return results.map((r) => ({
    displayName: "anonymous",
    wpm: r.wpm,
    accuracy: r.accuracy,
    mode: r.mode,
  }));
}
