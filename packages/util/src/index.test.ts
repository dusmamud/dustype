import { describe, expect, it } from "vitest";
import { calculateAccuracy, calculateStats, calculateWpm } from "./index";

describe("typing maths", () => {
  it("calculates wpm from correct chars over a minute", () => {
    expect(calculateWpm(250, 60)).toBe(50);
  });

  it("returns 0 wpm for zero elapsed time", () => {
    expect(calculateWpm(100, 0)).toBe(0);
  });

  it("calculates accuracy", () => {
    expect(calculateAccuracy(90, 10)).toBe(90);
    expect(calculateAccuracy(0, 0)).toBe(100);
  });

  it("combines stats", () => {
    const stats = calculateStats({
      correctChars: 250,
      incorrectChars: 50,
      elapsedSeconds: 60,
      totalTypedChars: 300,
    });
    expect(stats.wpm).toBe(50);
    expect(stats.rawWpm).toBe(60);
    expect(stats.accuracy).toBe(83);
  });
});
