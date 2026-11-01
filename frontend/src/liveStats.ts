/**
 * Pure live-stats maths for a running test.
 *
 * Conventions (kept identical to the end-of-test recomputation in App):
 * - A space submitted after a finished word counts as one correct char.
 * - Live WPM = correct chars / 5 / minutes, live accuracy =
 *   correct / (correct + incorrect), both delegated to @dustype/util so
 *   there is exactly one definition of each formula.
 * - Per-second history is a pair of parallel arrays: speed[i] is the WPM
 *   achieved during second i (0-based) and errors[i] is the number of
 *   incorrect characters typed during that second.
 */
import { calculateAccuracy, calculateWpm, countCharResults } from "@dustype/util";

export interface LiveCounters {
  correct: number;
  incorrect: number;
  /** Typed chars including submitted-word spaces (the raw-WPM basis). */
  totalTyped: number;
}

export interface FinishedWordLike {
  target: string;
  typed: string;
}

/**
 * Running correct/incorrect counters from finished words plus the word
 * currently being typed. Pure: no timers, no DOM, no signals.
 */
export function liveCounters(
  finishedWords: FinishedWordLike[],
  currentTarget: string | undefined,
  currentTyped: string,
): LiveCounters {
  let correct = 0;
  let incorrect = 0;
  let totalTyped = 0;
  for (const w of finishedWords) {
    const r = countCharResults(w.target, w.typed);
    correct += r.correct;
    incorrect += r.incorrect;
    totalTyped += w.typed.length;
  }
  // One submitted space per finished word, counted as correct.
  correct += finishedWords.length;
  totalTyped += finishedWords.length;
  if (currentTarget !== undefined && currentTyped.length > 0) {
    const r = countCharResults(currentTarget, currentTyped);
    correct += r.correct;
    incorrect += r.incorrect;
    totalTyped += currentTyped.length;
  }
  return { correct, incorrect, totalTyped };
}

/** Live WPM from the running correct-char count and elapsed seconds. */
export function liveWpm(correctChars: number, elapsedSeconds: number): number {
  return calculateWpm(correctChars, elapsedSeconds);
}

/** Live accuracy from the running correct/incorrect counters. */
export function liveAccuracy(correct: number, incorrect: number): number {
  return calculateAccuracy(correct, incorrect);
}

export interface PerSecondHistory {
  /** WPM per second bucket. */
  speed: number[];
  /** Incorrect chars per second bucket. */
  errors: number[];
}

export function emptyHistory(): PerSecondHistory {
  return { speed: [], errors: [] };
}

/**
 * Append one second bucket, padding any skipped seconds with zeroes so
 * speed[i] and errors[i] always describe second i. Deltas are the chars
 * typed since the previous bucket, so a bucket's WPM is
 * correctDelta / 5 * 60 (one minute's worth of that second's pace).
 */
export function recordSecond(
  history: PerSecondHistory,
  second: number,
  correctDelta: number,
  errorDelta: number,
): PerSecondHistory {
  if (second < 0) return history;
  const speed = [...history.speed];
  const errors = [...history.errors];
  while (speed.length <= second) {
    speed.push(0);
    errors.push(0);
  }
  speed[second] = Math.round((Math.max(0, correctDelta) / 5) * 60);
  errors[second] = Math.max(0, errorDelta);
  return { speed, errors };
}

/**
 * Drop trailing idle buckets (0 WPM and 0 errors) so a test that ends
 * with the user sitting still does not end in a flat tail on the chart.
 * Returns a copy; an all-idle history becomes empty.
 */
export function trimTrailingIdle(history: PerSecondHistory): PerSecondHistory {
  const speed = [...history.speed];
  const errors = [...history.errors];
  while (
    speed.length > 0 &&
    speed[speed.length - 1] === 0 &&
    errors[errors.length - 1] === 0
  ) {
    speed.pop();
    errors.pop();
  }
  return { speed, errors };
}
