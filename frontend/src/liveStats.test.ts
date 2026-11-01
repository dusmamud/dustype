import { describe, expect, it } from "vitest";
import {
  emptyHistory,
  liveAccuracy,
  liveCounters,
  liveWpm,
  recordSecond,
  trimTrailingIdle,
} from "./liveStats";

describe("liveCounters", () => {
  it("counts a submitted space per finished word as correct", () => {
    const counters = liveCounters(
      [{ target: "cat", typed: "cat" }],
      undefined,
      "",
    );
    expect(counters).toEqual({ correct: 4, incorrect: 0, totalTyped: 4 });
  });

  it("adds the current word's correct/incorrect chars", () => {
    const counters = liveCounters(
      [{ target: "cat", typed: "cat" }],
      "dog",
      "dox",
    );
    // Finished "cat" (3 correct + 1 space) + current "dox" (2 correct, 1 wrong).
    expect(counters).toEqual({ correct: 6, incorrect: 1, totalTyped: 7 });
  });
});

describe("liveWpm / liveAccuracy", () => {
  it("delegates to the shared util formulae", () => {
    expect(liveWpm(250, 60)).toBe(50);
    expect(liveWpm(100, 0)).toBe(0);
    expect(liveAccuracy(90, 10)).toBe(90);
    expect(liveAccuracy(0, 0)).toBe(100);
  });
});

describe("recordSecond", () => {
  it("converts a second's correct delta to that second's WPM pace", () => {
    const history = recordSecond(emptyHistory(), 0, 5, 1);
    expect(history).toEqual({ speed: [60], errors: [1] });
  });

  it("pads skipped seconds with zeroes and ignores negative seconds", () => {
    const history = recordSecond(emptyHistory(), 2, 10, 0);
    expect(history).toEqual({ speed: [0, 0, 120], errors: [0, 0, 0] });
    expect(recordSecond(history, -1, 5, 0)).toBe(history);
  });
});

describe("trimTrailingIdle", () => {
  it("drops only the trailing idle tail", () => {
    expect(
      trimTrailingIdle({ speed: [60, 0, 0], errors: [1, 0, 0] }),
    ).toEqual({ speed: [60], errors: [1] });
    expect(trimTrailingIdle({ speed: [0, 0], errors: [0, 0] })).toEqual({
      speed: [],
      errors: [],
    });
    expect(trimTrailingIdle({ speed: [60], errors: [0] })).toEqual({
      speed: [60],
      errors: [0],
    });
  });
});
