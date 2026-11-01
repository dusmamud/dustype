export interface TypingStatsInput {
  correctChars: number;
  incorrectChars: number;
  /** Seconds the test actually ran for. */
  elapsedSeconds: number;
  /** Total characters typed, including spaces, for raw WPM. */
  totalTypedChars: number;
}

export interface TypingStats {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
}

export function calculateWpm(correctChars: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  const minutes = elapsedSeconds / 60;
  return Math.round(correctChars / 5 / minutes);
}

export function calculateRawWpm(totalTypedChars: number, elapsedSeconds: number): number {
  if (elapsedSeconds <= 0) return 0;
  const minutes = elapsedSeconds / 60;
  return Math.round(totalTypedChars / 5 / minutes);
}

export function calculateAccuracy(correctChars: number, incorrectChars: number): number {
  const total = correctChars + incorrectChars;
  if (total === 0) return 100;
  return Math.round((correctChars / total) * 100);
}

export function calculateStats(input: TypingStatsInput): TypingStats {
  return {
    wpm: calculateWpm(input.correctChars, input.elapsedSeconds),
    rawWpm: calculateRawWpm(input.totalTypedChars, input.elapsedSeconds),
    accuracy: calculateAccuracy(input.correctChars, input.incorrectChars),
    correctChars: input.correctChars,
    incorrectChars: input.incorrectChars,
  };
}

export function pickRandomWords(wordList: string[], count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(wordList[Math.floor(Math.random() * wordList.length)]);
  }
  return out;
}

export function countCharResults(target: string, typed: string): {
  correct: number;
  incorrect: number;
} {
  let correct = 0;
  let incorrect = 0;
  for (let i = 0; i < typed.length; i++) {
    if (typed[i] === target[i]) correct++;
    else incorrect++;
  }
  return { correct, incorrect };
}
