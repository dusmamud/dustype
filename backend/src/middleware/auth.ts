import type { NextFunction, Request, Response } from "express";
import { verifyToken } from "../auth.js";

declare global {
  namespace Express {
    interface Request {
      /** User id from a verified Bearer token, when present. */
      userId?: string;
    }
  }
}

function readBearerToken(req: Request): string | null {
  const header = req.header("authorization");
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

/**
 * Optional auth: no token -> anonymous (req.userId stays unset).
 * A present but invalid token is rejected with 401 rather than
 * silently treated as anonymous, so a result is never stored under
 * the wrong owner (or anonymously when the user meant to be signed in).
 */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readBearerToken(req);
  if (!token) {
    next();
    return;
  }
  const verified = verifyToken(token);
  if (!verified) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  req.userId = verified.userId;
  next();
}

/** Required auth, e.g. GET /api/me. Missing or invalid token -> 401. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing token" });
    return;
  }
  const verified = verifyToken(token);
  if (!verified) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  req.userId = verified.userId;
  next();
}
