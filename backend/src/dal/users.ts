import { randomUUID } from "node:crypto";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "./db.js";

export interface UserRecord {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  createdAt: string;
}

export interface NewUser {
  email: string;
  displayName: string | null;
  passwordHash: string;
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("Email already registered");
    this.name = "DuplicateEmailError";
  }
}

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  create(input: NewUser): Promise<UserRecord>;
}

interface UserDoc {
  _id?: ObjectId;
  email: string;
  displayName: string | null;
  passwordHash: string;
  createdAt: string;
}

function toRecord(doc: UserDoc): UserRecord {
  return {
    id: doc._id ? doc._id.toHexString() : "",
    email: doc.email,
    displayName: doc.displayName,
    passwordHash: doc.passwordHash,
    createdAt: doc.createdAt,
  };
}

/** Store that uses Mongo when a DB is connected, else in-memory. */
export function createUserStore(): UserStore {
  const byId = new Map<string, UserRecord>();
  const byEmail = new Map<string, UserRecord>();

  async function mongo(db: Db): Promise<UserStore> {
    const collection = db.collection<UserDoc>("dustype_users");
    return {
      async findByEmail(email) {
        const doc = await collection.findOne({ email });
        return doc ? toRecord(doc) : null;
      },
      async findById(id) {
        if (!ObjectId.isValid(id)) return null;
        const doc = await collection.findOne({ _id: new ObjectId(id) });
        return doc ? toRecord(doc) : null;
      },
      async create(input) {
        const doc: UserDoc = { ...input, createdAt: new Date().toISOString() };
        try {
          const result = await collection.insertOne(doc);
          return toRecord({ ...doc, _id: result.insertedId });
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            (error as { code?: unknown }).code === 11000
          ) {
            throw new DuplicateEmailError();
          }
          throw error;
        }
      },
    };
  }

  const memory: UserStore = {
    async findByEmail(email) {
      return byEmail.get(email) ?? null;
    },
    async findById(id) {
      return byId.get(id) ?? null;
    },
    async create(input) {
      if (byEmail.has(input.email)) throw new DuplicateEmailError();
      const record: UserRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      byId.set(record.id, record);
      byEmail.set(record.email, record);
      return record;
    },
  };

  // Resolve the backend once per call so a store created before the
  // server's initDb() still picks up Mongo on first use.
  return {
    async findByEmail(email) {
      const db = await getDb();
      return db ? (await mongo(db)).findByEmail(email) : memory.findByEmail(email);
    },
    async findById(id) {
      const db = await getDb();
      return db ? (await mongo(db)).findById(id) : memory.findById(id);
    },
    async create(input) {
      const db = await getDb();
      return db ? (await mongo(db)).create(input) : memory.create(input);
    },
  };
}
