import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { z } from "zod";

// Own dustype auth code: no external auth library, no copied schema.
// Passwords use Node's built-in scrypt; tokens are HMAC-SHA256 signed
// (header.payload.signature, base64url) — deliberately not a JWT library,
// so Phase 2 adds zero new dependencies.

export const registerSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  displayName: z.string().min(1).max(50).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days

function getTokenSecret(): string {
  // Read at call time (not import time) so tests / server start order
  // never freezes an empty secret. The fallback is dev-only and is
  // documented in example.env; production must set JWT_SECRET.
  return process.env.JWT_SECRET ?? "dustype-dev-secret-change-me";
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, 64);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

export function signToken(userId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({
    sub: userId,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  });
  const encoded = base64url(payload);
  const signature = createHmac("sha256", getTokenSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyToken(token: string): { userId: string } | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const expected = createHmac("sha256", getTokenSecret())
    .update(encoded)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as { sub?: unknown; exp?: unknown };
    if (typeof payload.sub !== "string" || payload.sub.length === 0) return null;
    if (typeof payload.exp !== "number") return null;
    if (payload.exp * 1000 < Date.now()) return null;
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export function publicUser(user: {
  id: string;
  email: string;
  displayName: string | null;
  createdAt: string;
}): PublicUser {
  // Explicit allow-list: a password hash can never leak through here,
  // even if the stored record gains new fields later.
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}
