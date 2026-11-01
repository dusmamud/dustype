import { describe, expect, it } from "vitest";
import {
  hashPassword,
  loginSchema,
  registerSchema,
  signToken,
  verifyPassword,
  verifyToken,
} from "../src/auth";

// No server, no DB, no network: pure scrypt/HMAC round-trips only.
// The secret is read at call time, so a test-only value set here is
// what sign/verify use; it never touches example.env or real data.
process.env.JWT_SECRET = "dustype-test-secret-only";

describe("password hashing", () => {
  it("verifies the correct password and rejects a wrong one", () => {
    const stored = hashPassword("correct horse battery");
    expect(stored.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("correct horse battery", stored)).toBe(true);
    expect(verifyPassword("wrong password here", stored)).toBe(false);
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(verifyPassword("anything", "scrypt::")).toBe(false);
  });
});

describe("tokens", () => {
  it("signs and verifies a round-trip token", () => {
    const token = signToken("user-123");
    expect(verifyToken(token)).toEqual({ userId: "user-123" });
  });

  it("rejects tampered and garbage tokens", () => {
    const token = signToken("user-123");
    // Appending a char changes the signature length, so verification
    // must fail deterministically (replacing a char could be a no-op
    // if the original char already matched).
    expect(verifyToken(`${token}x`)).toBeNull();
    expect(verifyToken("garbage")).toBeNull();
    expect(verifyToken("")).toBeNull();
  });
});

describe("auth schemas", () => {
  it("accepts valid input and rejects a short password", () => {
    expect(
      registerSchema.safeParse({
        email: "a@example.com",
        password: "long-enough",
      }).success,
    ).toBe(true);
    expect(
      loginSchema.safeParse({ email: "a@example.com", password: "short" })
        .success,
    ).toBe(false);
  });
});
