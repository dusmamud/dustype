import { z } from "zod";

export const testModeSchema = z.enum(["time", "words"]);
export type TestMode = z.infer<typeof testModeSchema>;

export const testConfigSchema = z.object({
  mode: testModeSchema,
  timeLimit: z.number().int().min(5).max(600).optional(),
  wordCount: z.number().int().min(5).max(500).optional(),
  language: z.string().min(1).max(20).default("en"),
});
export type TestConfig = z.infer<typeof testConfigSchema>;

export const typingResultSchema = z.object({
  mode: testModeSchema,
  wpm: z.number().min(0),
  rawWpm: z.number().min(0),
  accuracy: z.number().min(0).max(100),
  correctChars: z.number().int().min(0),
  incorrectChars: z.number().int().min(0),
  elapsedSeconds: z.number().min(0),
  wordCount: z.number().int().min(0),
  createdAt: z.string().datetime().optional(),
});
export type TypingResult = z.infer<typeof typingResultSchema>;

export const wordsQuerySchema = z.object({
  count: z.coerce.number().int().min(5).max(500).default(50),
});
