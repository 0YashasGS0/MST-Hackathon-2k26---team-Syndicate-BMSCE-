import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";

const CHAIN_ID = 91562037;
const NONCE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_SECONDS = 60 * 60;
const SESSION_COOKIE = "mst_session";

type SqliteStatement = {
  get(...values: (string | number)[]): unknown;
  run(...values: (string | number)[]): { changes: number };
};

export type AuthSqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
};

type UserRow = { address: unknown; handle: unknown; kyc_level: unknown };
type NonceRow = { expires_at: unknown };

export type ApiUser = {
  address: string;
  handle?: string;
  kycLevel: 0 | 1 | 2;
};

export type AuthConfig = {
  domain?: string;
  uri?: string;
  sessionSecret?: string;
  devHeaderEnabled?: boolean;
  secureCookie?: boolean;
  now?: () => number;
};

function configFromEnvironment(): AuthConfig {
  return {
    domain: process.env.AUTH_DOMAIN,
    uri: process.env.AUTH_URI,
    sessionSecret: process.env.AUTH_SESSION_SECRET,
    devHeaderEnabled: process.env.AUTH_DEV_HEADER === "true",
    secureCookie: process.env.NODE_ENV === "production",
  };
}

function toApiUser(value: unknown): ApiUser {
  if (typeof value !== "object" || value === null) throw new Error("User row was not found");
  const row = value as UserRow;
  const level = Number(row.kyc_level);
  if (level !== 0 && level !== 1 && level !== 2) throw new Error("User has an invalid KYC level");
  return {
    address: getAddress(String(row.address)),
    ...(typeof row.handle === "string" ? { handle: row.handle } : {}),
    kycLevel: level,
  };
}

function findOrCreateUser(database: AuthSqliteDatabase, address: Address): ApiUser {
  database.prepare(
    `INSERT INTO users (address, kyc_level) VALUES (?, 0)
     ON CONFLICT(address) DO NOTHING`,
  ).run(address.toLowerCase());
  const row = database.prepare(
    "SELECT address, handle, kyc_level FROM users WHERE address = ?",
  ).get(address.toLowerCase());
  return toApiUser(row);
}

/** Shared demo API-key guard used by B1 and PG routers. */
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

function configuredSessionSecret(config: AuthConfig): string | null {
  const secret = config.sessionSecret ?? configFromEnvironment().sessionSecret;
  return secret && Buffer.byteLength(secret, "utf8") >= 32 ? secret : null;
}

function signSession(address: Address, secret: string, now: number): string {
  const payload = Buffer.from(JSON.stringify({
    address,
    expiresAt: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    id: randomBytes(16).toString("hex"),
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function verifySession(token: string, secret: string, now: number): Address | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      address?: unknown;
      expiresAt?: unknown;
      id?: unknown;
    };
    if (typeof decoded.address !== "string" || typeof decoded.expiresAt !== "number" || decoded.expiresAt <= now / 1000) {
      return null;
    }
    return getAddress(decoded.address);
  } catch {
    return null;
  }
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (typeof header !== "string") return null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** Return only a cryptographically verified session address. The legacy header is opt-in for local tests. */
export function getCaller(req: Request, overrides: AuthConfig = {}): Address | null {
  const environment = configFromEnvironment();
  const config = { ...environment, ...overrides };
  const secret = configuredSessionSecret(config);
  const token = readCookie(req, SESSION_COOKIE);
  if (secret && token) {
    const address = verifySession(token, secret, (config.now ?? Date.now)());
    if (address) return address;
  }
  if (config.devHeaderEnabled) {
    const header = req.header("x-user-address");
    if (header) {
      try { return getAddress(header); } catch { return null; }
    }
  }
  return null;
}

/** Express guard for routes that need an authenticated caller. */
export function requireCaller(req: Request, res: Response, next: NextFunction): void {
  const address = getCaller(req);
  if (!address) {
    res.status(401).json({ error: { code: "Unauthorized", message: "A valid wallet session is required" } });
    return;
  }
  res.locals.callerAddress = address;
  next();
}

function getDomain(config: AuthConfig): string | null {
  const domain = config.domain ?? configFromEnvironment().domain;
  return domain?.trim() || null;
}

function getUri(config: AuthConfig, domain: string): string {
  return config.uri ?? configFromEnvironment().uri ?? `https://${domain}`;
}

function formatSignInMessage(
  domain: string,
  uri: string,
  address: Address,
  nonce: string,
  issuedAt: string,
  expirationTime: string,
): string {
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to MST DealEscrow.\n\nURI: ${uri}\nVersion: 1\nChain ID: ${CHAIN_ID}\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
}

function parseSignInMessage(message: string): {
  domain: string;
  address: Address;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: number;
  expirationTime: number;
} | null {
  const lines = message.split("\n");
  if (lines.length !== 11 || lines[2] !== "" || lines[4] !== "") return null;
  const domainMatch = /^([^\s]+) wants you to sign in with your Ethereum account:$/.exec(lines[0]);
  const uriMatch = /^URI: (.+)$/.exec(lines[5]);
  const chainMatch = /^Chain ID: (\d+)$/.exec(lines[7]);
  const nonceMatch = /^Nonce: ([a-zA-Z0-9]+)$/.exec(lines[8]);
  const issuedMatch = /^Issued At: (.+)$/.exec(lines[9]);
  const expiresMatch = /^Expiration Time: (.+)$/.exec(lines[10]);
  if (!domainMatch || !uriMatch || !chainMatch || !nonceMatch || !issuedMatch || !expiresMatch ||
    lines[3] !== "Sign in to MST DealEscrow." || lines[6] !== "Version: 1") return null;
  try {
    const issuedAt = Date.parse(issuedMatch[1]);
    const expirationTime = Date.parse(expiresMatch[1]);
    return {
      domain: domainMatch[1],
      address: getAddress(lines[1]),
      uri: uriMatch[1],
      chainId: Number(chainMatch[1]),
      nonce: nonceMatch[1],
      issuedAt,
      expirationTime,
    };
  } catch {
    return null;
  }
}

/**
 * Mount at the Express app root. Nonces are persisted in the shared SQLite DB,
 * so a process restart cannot make an issued nonce reusable.
 */
export function createAuthRouter(
  database: AuthSqliteDatabase,
  overrides: AuthConfig = {},
): Router {
  const router = Router();
  const config = { ...configFromEnvironment(), ...overrides };
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_nonces (
      address TEXT PRIMARY KEY COLLATE NOCASE,
      nonce TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL
    );
  `);

  router.get("/auth/nonce", (req: Request, res: Response) => {
    const domain = getDomain(config);
    if (!domain) {
      res.status(503).json({ error: { code: "AuthNotConfigured", message: "AUTH_DOMAIN is not configured" } });
      return;
    }
    let address: Address;
    try {
      const supplied = req.query.address;
      if (typeof supplied !== "string") throw new Error("missing address");
      address = getAddress(supplied);
    } catch {
      res.status(400).json({ error: { code: "BadRequest", message: "A valid address query parameter is required" } });
      return;
    }
    const now = (config.now ?? Date.now)();
    const expiresAt = now + NONCE_TTL_MS;
    const nonce = randomBytes(16).toString("hex");
    const issuedAtIso = new Date(now).toISOString();
    const expirationIso = new Date(expiresAt).toISOString();
    database.prepare(
      `INSERT INTO auth_nonces (address, nonce, expires_at) VALUES (?, ?, ?)
       ON CONFLICT(address) DO UPDATE SET nonce = excluded.nonce, expires_at = excluded.expires_at`,
    ).run(address.toLowerCase(), nonce, expiresAt);
    res.json({
      nonce,
      chainId: CHAIN_ID,
      domain,
      issuedAt: issuedAtIso,
      expirationTime: expirationIso,
      messageToSign: formatSignInMessage(domain, getUri(config, domain), address, nonce, issuedAtIso, expirationIso),
    });
  });

  router.post("/auth/verify", async (req: Request, res: Response) => {
    const secret = configuredSessionSecret(config);
    const domain = getDomain(config);
    if (!secret || !domain) {
      res.status(503).json({ error: { code: "AuthNotConfigured", message: "AUTH_DOMAIN and a 32-byte AUTH_SESSION_SECRET are required" } });
      return;
    }
    const { message, signature } = req.body ?? {};
    if (typeof message !== "string" || message.length > 4096 || typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
      res.status(400).json({ error: { code: "BadRequest", message: "message and signature are required" } });
      return;
    }
    const parsed = parseSignInMessage(message);
    const now = (config.now ?? Date.now)();
    if (!parsed || parsed.domain !== domain || parsed.uri !== getUri(config, domain) || parsed.chainId !== CHAIN_ID ||
      !Number.isFinite(parsed.issuedAt) || !Number.isFinite(parsed.expirationTime) ||
      parsed.issuedAt > now + 60_000 || parsed.issuedAt < now - NONCE_TTL_MS ||
      parsed.expirationTime <= now || parsed.expirationTime - parsed.issuedAt > NONCE_TTL_MS) {
      res.status(401).json({ error: { code: "InvalidMessage", message: "Sign-in message is invalid, expired, or for another chain" } });
      return;
    }

    let valid: boolean;
    try {
      valid = await verifyMessage({ address: parsed.address, message, signature: signature as Hex });
    } catch {
      valid = false;
    }
    if (!valid) {
      res.status(401).json({ error: { code: "InvalidSignature", message: "Wallet signature is invalid" } });
      return;
    }

    const row = database.prepare("SELECT expires_at FROM auth_nonces WHERE address = ? AND nonce = ?")
      .get(parsed.address.toLowerCase(), parsed.nonce) as NonceRow | undefined;
    if (!row || Number(row.expires_at) !== parsed.expirationTime) {
      res.status(401).json({ error: { code: "InvalidNonce", message: "Nonce is missing, expired, or already used" } });
      return;
    }
    const consumed = database.prepare(
      "DELETE FROM auth_nonces WHERE address = ? AND nonce = ? AND expires_at > ?",
    ).run(parsed.address.toLowerCase(), parsed.nonce, now);
    if (consumed.changes !== 1) {
      res.status(401).json({ error: { code: "InvalidNonce", message: "Nonce is missing, expired, or already used" } });
      return;
    }

    const user = findOrCreateUser(database, parsed.address);
    const token = signSession(parsed.address, secret, now);
    const cookieParts = [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "HttpOnly",
      "Path=/",
      "SameSite=Lax",
      `Max-Age=${SESSION_TTL_SECONDS}`,
    ];
    if (config.secureCookie ?? process.env.NODE_ENV === "production") cookieParts.push("Secure");
    res.setHeader("Set-Cookie", cookieParts.join("; "));
    res.json({ user, expiresIn: SESSION_TTL_SECONDS });
  });

  router.post("/auth/logout", (_req: Request, res: Response) => {
    const parts = [`${SESSION_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
    if (config.secureCookie ?? process.env.NODE_ENV === "production") parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
    res.status(204).end();
  });

  router.post("/auth/saral", async (req: Request, res: Response) => {
    const { address: suppliedAddress, saralSessionProof } = req.body ?? {};
    if (typeof suppliedAddress !== "string" || saralSessionProof === undefined || saralSessionProof === null) {
      res.status(400).json({ error: { code: "BadRequest", message: "address and saralSessionProof are required" } });
      return;
    }
    // No mentor docs exist in this checkout, so even SARAL_ENABLED=true cannot
    // activate an assumed provider or proof flow.
    res.status(503).json({ error: { code: "SaralUnavailable", message: "SARAL not configured: awaiting mentor docs" } });
  });

  return router;
}

export const authSessionCookieName = SESSION_COOKIE;
export const authNonceTtlMs = NONCE_TTL_MS;
