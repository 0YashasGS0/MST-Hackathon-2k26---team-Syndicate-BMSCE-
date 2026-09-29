// App-level defenses shared by every route: config validation, CORS allowlist, security headers, rate limits,
// the admin token, upload limits and a last-resort error handler that never leaks internals.
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import path from "node:path";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";

const isProd = () => process.env.NODE_ENV === "production";
const WEAK = /^(change-me|changeme|test|secret|password|admin)/i;

/**
 * Refuses to start in production with an unsafe configuration. Returns the problems (empty = OK) so tests can
 * inspect them; `assertSafeConfig` throws with all of them at once.
 */
export function configProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const p: string[] = [];
  const strong = (name: string, min: number) => {
    const v = env[name];
    if (!v) p.push(`${name} is required`);
    else if (Buffer.byteLength(v, "utf8") < min || WEAK.test(v)) p.push(`${name} must be a random value of at least ${min} bytes`);
  };
  if (env.AUTH_DEV_HEADER === "true") p.push("AUTH_DEV_HEADER=true lets any client impersonate any address; it must be off in production");
  strong("AUTH_SESSION_SECRET", 32);
  strong("BACKEND_API_KEY", 16);
  strong("ADMIN_TOKEN", 24);
  if (!env.AUTH_DOMAIN) p.push("AUTH_DOMAIN is required (the frontend's host, checked in the sign-in message)");
  if (!env.CORS_ORIGINS) p.push("CORS_ORIGINS is required (comma-separated frontend origins, e.g. https://app.example.com)");
  else if (env.CORS_ORIGINS.split(",").some((o) => o.trim() === "*")) p.push("CORS_ORIGINS must list exact origins, not *");
  if (env.AGENT_DEMO_FALLBACK === "true" || env.AGENT_FALLBACK_ON_FAILURE === "true") {
    p.push("AGENT_DEMO_FALLBACK / AGENT_FALLBACK_ON_FAILURE are demo-only and must be off in production");
  }
  return p;
}

export function assertSafeConfig(env: NodeJS.ProcessEnv = process.env): void {
  const p = configProblems(env);
  if (p.length) throw new Error(`Unsafe production configuration:\n - ${p.join("\n - ")}`);
}

/** Exact-origin allowlist with credentials (PG's session cookie). Dev default: the local Next.js app. */
export function corsMiddleware(env: NodeJS.ProcessEnv = process.env): RequestHandler {
  const allowed = new Set(
    (env.CORS_ORIGINS ?? (env.NODE_ENV === "production" ? "" : "http://localhost:3000,http://127.0.0.1:3000"))
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
  );
  return cors({
    origin: (origin, cb) => cb(null, !origin || allowed.has(origin)), // no Origin = same-origin / server-to-server
    credentials: true,
    methods: ["GET", "POST", "PATCH", "OPTIONS"],
    allowedHeaders: ["content-type", "x-api-key", "x-admin-token", "x-user-address"],
    maxAge: 600,
  });
}

/** JSON API headers: no sniffing, no framing, no referrer leaks, HSTS in production. */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: "same-site" },
    hsts: isProd() ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: "no-referrer" },
  });
}

const limiter = (windowMs: number, limit: number, what: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: { code: "RateLimited", message: `too many ${what}; try again later` } },
  });

/** Per-IP limits. `expensive` guards routes that cost LLM calls or send wallet transactions. */
export const rateLimits = {
  global: () => limiter(60_000, Number(process.env.RATE_LIMIT_PER_MIN ?? 300), "requests"),
  auth: () => limiter(60_000, 20, "sign-in attempts"),
  expensive: () => limiter(60_000, Number(process.env.RATE_LIMIT_EXPENSIVE_PER_MIN ?? 10), "agent or on-chain requests"),
  upload: () => limiter(60_000, 20, "uploads"),
};

const sha = (s: string) => createHash("sha256").update(s).digest();

/** Admin console / operator actions (X-Admin-Token = ADMIN_TOKEN), compared in constant time. */
export function requireAdminToken(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.ADMIN_TOKEN;
  const got = req.header("x-admin-token");
  if (!expected) {
    res.status(503).json({ error: { code: "AdminNotConfigured", message: "ADMIN_TOKEN is not configured" } });
    return;
  }
  if (!got || !timingSafeEqual(sha(got), sha(expected))) {
    res.status(401).json({ error: { code: "Unauthorized", message: "missing or invalid X-Admin-Token header" } });
    return;
  }
  next();
}

// Evidence can be phone videos: 5 files × 20 MB (the frontend enforces the same; Caddy caps a request at 110 MB).
export const UPLOAD_LIMITS = { fileSize: 20 * 1024 * 1024, files: 5, fields: 30, fieldSize: 64 * 1024 };
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "application/zip",
  "application/json",
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

/** multer with size/count limits, a type allowlist and random, extension-less file names (never the client's name). */
export function safeUpload(dir: string, limits: Partial<typeof UPLOAD_LIMITS> = {}) {
  return multer({
    storage: multer.diskStorage({
      destination: dir,
      filename: (_req, _file, cb) => cb(null, randomBytes(16).toString("hex")),
    }),
    limits: { ...UPLOAD_LIMITS, ...limits },
    fileFilter: (_req, file, cb) => {
      if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
      cb(new multer.MulterError("LIMIT_UNEXPECTED_FILE", `unsupported file type ${path.basename(file.mimetype)}`));
    },
  });
}

/** Last error handler: known client errors get their status; everything else is a generic 500 (logged, not sent). */
export function errorHandler() {
  return (err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      return void res.status(status).json({ error: { code: "UploadRejected", message: err.field && err.code === "LIMIT_UNEXPECTED_FILE" ? err.field : err.message } });
    }
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.parse.failed") return void res.status(400).json({ error: { code: "BadRequest", message: "malformed JSON body" } });
    if (e?.type === "entity.too.large") return void res.status(413).json({ error: { code: "PayloadTooLarge", message: "request body too large" } });
    if (e?.status === 403 && /cors/i.test(String((err as Error).message))) return void res.status(403).json({ error: { code: "Forbidden", message: "origin not allowed" } });
    console.error("[backend] unhandled error:", err instanceof Error ? err.stack : err);
    res.status(500).json({ error: { code: "Internal", message: "internal error" } });
  };
}
