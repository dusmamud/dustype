import { initContract } from "@ts-rest/core";
import { z } from "zod";
import { typingResultSchema, wordsQuerySchema } from "@dustype/schemas";

const c = initContract();

export const dustypeContract = c.router({
  getHealth: {
    method: "GET",
    path: "/api/health",
    responses: {
      200: z.object({ ok: z.literal(true), service: z.string() }),
    },
  },
  getWords: {
    method: "GET",
    path: "/api/words",
    query: wordsQuerySchema,
    responses: {
      200: z.object({ words: z.array(z.string()) }),
    },
  },
  submitResult: {
    method: "POST",
    path: "/api/results",
    body: typingResultSchema,
    responses: {
      201: z.object({ id: z.string() }),
      400: z.object({ error: z.string() }),
    },
  },
  listResults: {
    method: "GET",
    path: "/api/results",
    responses: {
      200: z.object({
        results: z.array(typingResultSchema.extend({ id: z.string() })),
      }),
    },
  },
});
