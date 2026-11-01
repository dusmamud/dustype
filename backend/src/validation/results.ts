// Backend-local result validation for dustype Phase 3.
// This runs AFTER the shared Zod schema (which only checks types
// and ranges) and BEFORE anything is stored. It does not change
// the shared schema or the success shape ({id}).
// Thresholds are deliberately generous, so a slow or imperfect
// legitimate typist is never rejected: only results that are
// physically implausible or internally inconsistent are blocked.

export interface ResultInput {
  mode: "time" | "words";
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
  elapsedSeconds: number;
  wordCount: number;
}

// Reasoning for each threshold:
// - MAX_WPM 300: world-class typists peak well under 300 WPM on
//   sustained English text; anything above that with a substantial
//   sample is almost certainly forged or a timing bug.
// - MIN_ACCURACY 20: below 20% correct on 50+ characters is not a
//   completed test, it is random key mashing. The 50-char floor
//   protects very short tests, where one or two mistakes swing
//   accuracy wildly.
// - SUBSTANTIAL_CHARS 50: below this, WPM/accuracy are too noisy
//   to judge, so only the structural checks (elapsed, empty)
//   apply, not the WPM/accuracy floors.
export const MAX_WPM = 300;
export const MIN_ACCURACY = 20;
export const SUBSTANTIAL_CHARS = 50;
export const MAX_ELAPSED_SECONDS = 3600;

// Elapsed-time checks, expressed per wordCount so they scale:
// - Faster than 0.2s per word (5 words/second sustained) is not
//   human typing, even for very short words.
// - Slower than 180s per word (3 minutes per word) is an idle or
//   abandoned test, not a completed one.
// Both need wordCount >= 10 to avoid flagging tiny samples.
export const MIN_SECONDS_PER_WORD = 0.2;
export const MAX_SECONDS_PER_WORD = 180;

export function validateResultSanity(input: ResultInput): string | null {
  const totalChars = input.correctChars + input.incorrectChars;

  if (totalChars === 0) {
    return "No characters typed";
  }
  if (!(input.elapsedSeconds > 0)) {
    return "Elapsed time must be positive";
  }
  if (input.elapsedSeconds > MAX_ELAPSED_SECONDS) {
    return "Elapsed time is implausibly long";
  }
  if (input.wordCount >= 10) {
    if (input.elapsedSeconds < input.wordCount * MIN_SECONDS_PER_WORD) {
      return "Elapsed time is implausibly short for the word count";
    }
    if (input.elapsedSeconds > input.wordCount * MAX_SECONDS_PER_WORD) {
      return "Elapsed time is implausibly long for the word count";
    }
  }
  if (totalChars >= SUBSTANTIAL_CHARS) {
    if (input.accuracy < MIN_ACCURACY) {
      return "Accuracy is below the minimum for a valid result";
    }
    if (input.wpm > MAX_WPM) {
      return "WPM is implausibly high";
    }
  }
  // Headline WPM can never exceed raw WPM by more than rounding:
  // raw counts every typed character, WPM counts only correct ones.
  if (input.wpm > input.rawWpm + 5) {
    return "WPM cannot exceed raw WPM";
  }
  return null;
}

// Duplicate detection: same owner/IP + same payload within a short
// window. This catches accidental double-submits and naive replay
// of one result. It is in-memory only (same caveat as the rate
// limiter): a restart clears the window, and a Phase 4 DB query
// would be needed for cross-restart / cross-instance dedup.
export const DUPLICATE_WINDOW_MS = 60 * 1000;

function payloadKey(input: ResultInput): string {
  return JSON.stringify([
    input.mode,
    input.wpm,
    input.rawWpm,
    input.accuracy,
    input.correctChars,
    input.incorrectChars,
    input.elapsedSeconds,
    input.wordCount,
  ]);
}

export class ResultDuplicateTracker {
  private readonly seen = new Map<string, number>();

  /**
   * Returns true if this exact result was already seen from the
   * same owner key within the duplicate window, and does NOT
   * update the timestamp (so the window does not slide forever
   * on repeated replays). Otherwise records it and returns false.
   */
  checkAndRecord(ownerKey: string, input: ResultInput, now = Date.now()): boolean {
    const key = `${ownerKey}:${payloadKey(input)}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < DUPLICATE_WINDOW_MS) {
      return true;
    }
    this.seen.set(key, now);
    return false;
  }
}

export function duplicateOwnerKey(ownerId: string | null, ip: string | undefined): string {
  return ownerId ? `user:${ownerId}` : `ip:${ip ?? "unknown"}`;
}
