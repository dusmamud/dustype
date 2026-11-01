import { randomUUID } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "./db.js";

export interface StoredResult {
  id: string;
  mode: "time" | "words";
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
  elapsedSeconds: number;
  wordCount: number;
  /** Token-derived owner, or null for anonymous results (Phase 2). */
  ownerId: string | null;
  createdAt: string;
}

export type NewResult = Omit<StoredResult, "id" | "createdAt">;

export interface ResultStore {
  create(input: NewResult): Promise<StoredResult>;
  /** Only this owner's results, newest first. */
  listByOwner(ownerId: string, limit?: number): Promise<StoredResult[]>;
  /** Only anonymous results, newest first (Phase 1 behaviour). */
  listAnonymous(limit?: number): Promise<StoredResult[]>;
  /**
   * All results, highest WPM first. Phase 3 leaderboard source.
   * Callers must strip sensitive fields before returning it;
   * see services/bests.ts toLeaderboardEntries().
   */
  listAll(limit?: number): Promise<StoredResult[]>;
}

interface ResultDoc {
  _id?: ObjectId;
  mode: StoredResult["mode"];
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  incorrectChars: number;
  elapsedSeconds: number;
  wordCount: number;
  ownerId: string | null;
  createdAt: string;
}

function toStored(doc: ResultDoc): StoredResult {
  return {
    id: doc._id ? doc._id.toHexString() : "",
    mode: doc.mode,
    wpm: doc.wpm,
    rawWpm: doc.rawWpm,
    accuracy: doc.accuracy,
    correctChars: doc.correctChars,
    incorrectChars: doc.incorrectChars,
    elapsedSeconds: doc.elapsedSeconds,
    wordCount: doc.wordCount,
    ownerId: doc.ownerId,
    createdAt: doc.createdAt,
  };
}

/** Store that uses Mongo when a DB is connected, else in-memory. */
export function createResultStore(): ResultStore {
  const memory: StoredResult[] = [];

  return {
    async create(input) {
      const db = await getDb();
      const createdAt = new Date().toISOString();
      if (!db) {
        const stored: StoredResult = { ...input, id: randomUUID(), createdAt };
        memory.push(stored);
        return stored;
      }
      const doc: ResultDoc = { ...input, createdAt };
      const result = await db.collection<ResultDoc>("dustype_results").insertOne(doc);
      return toStored({ ...doc, _id: result.insertedId });
    },
    async listByOwner(ownerId, limit = 50) {
      const db = await getDb();
      if (!db) {
        return [...memory]
          .filter((r) => r.ownerId === ownerId)
          .reverse()
          .slice(0, limit);
      }
      const docs = await db
        .collection<ResultDoc>("dustype_results")
        .find({ ownerId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return docs.map(toStored);
    },
    async listAnonymous(limit = 50) {
      const db = await getDb();
      if (!db) {
        return [...memory]
          .filter((r) => r.ownerId === null)
          .reverse()
          .slice(0, limit);
      }
      const docs = await db
        .collection<ResultDoc>("dustype_results")
        .find({ ownerId: null })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return docs.map(toStored);
    },
    async listAll(limit = 50) {
      const db = await getDb();
      if (!db) {
        return [...memory]
          .sort((a, b) => b.wpm - a.wpm)
          .slice(0, limit);
      }
      const docs = await db
        .collection<ResultDoc>("dustype_results")
        .find({})
        .sort({ wpm: -1 })
        .limit(limit)
        .toArray();
      return docs.map(toStored);
    },
  };
}
