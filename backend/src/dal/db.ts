import { MongoClient, type Db } from "mongodb";

// Lazy MongoDB client. Nothing connects at import time, so builds and
// tests pass with no database at all: when DB_URI is unset, getDb()
// returns null and the stores fall back to in-memory implementations.

let client: MongoClient | null = null;
let db: Db | null = null;
let dbResolved = false;
let indexesEnsured = false;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DB_URI);
}

export async function ensureIndexes(database: Db): Promise<void> {
  if (indexesEnsured) return;
  await database
    .collection("dustype_users")
    .createIndex({ email: 1 }, { unique: true });
  await database
    .collection("dustype_results")
    .createIndex({ ownerId: 1, createdAt: -1 });
  indexesEnsured = true;
}

export async function getDb(): Promise<Db | null> {
  if (dbResolved) return db;
  const uri = process.env.DB_URI;
  if (!uri) {
    dbResolved = true;
    return null;
  }
  try {
    client = new MongoClient(uri);
    await client.connect();
    db = client.db();
    await ensureIndexes(db);
    dbResolved = true;
    return db;
  } catch (error) {
    // A down/unreachable database must not take the app down in
    // Phase 2: fall back to in-memory stores for this process lifetime.
    // The failure is logged so an operator can see it, and a restart
    // retries the connection.
    console.error("[dustype] MongoDB connection failed, using in-memory stores:", error);
    dbResolved = true;
    db = null;
    return null;
  }
}

/** Called on server start only (see server.ts). No-op without DB_URI. */
export async function initDb(): Promise<Db | null> {
  if (!isDbConfigured()) return null;
  return getDb();
}
