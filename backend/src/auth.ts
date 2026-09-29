// PLACEHOLDER for PG's auth module (branch `geeth-dev`); replaced wholesale by PG's real backend/src/auth.ts at merge.
// Same semantics as PG's: x-user-address only when AUTH_DEV_HEADER=true (no sessions here), X-API-Key = BACKEND_API_KEY.
import { Router, type NextFunction, type Request, type Response } from "express";

export function getCaller(req: Request): `0x${string}` | null {
  if (process.env.AUTH_DEV_HEADER !== "true") return null;
  const h = req.header("x-user-address");
  return h && /^0x[0-9a-fA-F]{40}$/.test(h) ? (h as `0x${string}`) : null;
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.BACKEND_API_KEY;
  if (!expected) {
    res.status(503).json({ error: { code: "AuthNotConfigured", message: "API authentication is not configured" } });
    return;
  }
  if (req.header("X-API-Key") !== expected) {
    res.status(401).json({ error: { code: "Unauthorized", message: "Missing or invalid X-API-Key header" } });
    return;
  }
  next();
}

export const createAuthRouter = (_database: unknown) => Router();
