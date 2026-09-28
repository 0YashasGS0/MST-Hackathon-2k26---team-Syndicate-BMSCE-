import { createServer, type Server } from "node:http";
import express, { type Request } from "express";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authSessionCookieName, createAuthRouter, getCaller, type AuthSqliteDatabase } from "../src/auth";

const account = privateKeyToAccount(`0x${"11".repeat(32)}`);
const otherAccount = privateKeyToAccount(`0x${"22".repeat(32)}`);
const sessionSecret = "test-only-session-secret-at-least-32-bytes-long";

class MemoryAuthDatabase implements AuthSqliteDatabase {
  private nonces = new Map<string, { nonce: string; expires_at: number }>();
  private users = new Map<string, { address: string; handle: null; kyc_level: number }>();

  exec(_sql: string): void {}

  prepare(sql: string): {
    get: (...values: (string | number)[]) => unknown;
    run: (...values: (string | number)[]) => { changes: number };
  } {
    if (sql.includes("INSERT INTO auth_nonces")) {
      return { run: (address, nonce, expires_at) => {
        this.nonces.set(String(address).toLowerCase(), { nonce: String(nonce), expires_at: Number(expires_at) });
        return { changes: 1 };
      }, get: () => undefined };
    }
    if (sql.includes("SELECT expires_at FROM auth_nonces")) {
      return { get: (address, nonce) => {
        const row = this.nonces.get(String(address).toLowerCase());
        return row?.nonce === String(nonce) ? row : undefined;
      }, run: () => ({ changes: 0 }) };
    }
    if (sql.includes("DELETE FROM auth_nonces")) {
      return { run: (address, nonce, now) => {
        const key = String(address).toLowerCase();
        const row = this.nonces.get(key);
        if (!row || row.nonce !== String(nonce) || row.expires_at <= Number(now)) return { changes: 0 };
        this.nonces.delete(key);
        return { changes: 1 };
      }, get: () => undefined };
    }
    if (sql.includes("INSERT INTO users")) {
      return { run: (address) => {
        const userAddress = String(address);
        const key = userAddress.toLowerCase();
        if (!this.users.has(key)) this.users.set(key, { address: userAddress, handle: null, kyc_level: 0 });
        return { changes: 1 };
      }, get: () => undefined };
    }
    if (sql.includes("SELECT address, handle, kyc_level FROM users")) {
      return { get: (address) => this.users.get(String(address).toLowerCase()), run: () => ({ changes: 0 }) };
    }
    throw new Error(`Unexpected SQL in test fake: ${sql}`);
  }
}

let server: Server;
let baseUrl: string;
let now: number;
let database: MemoryAuthDatabase;

beforeEach(async () => {
  now = Date.parse("2026-09-29T12:00:00.000Z");
  database = new MemoryAuthDatabase();
  const app = express();
  app.use(express.json());
  app.use(createAuthRouter(database, {
    domain: "localhost",
    uri: "http://localhost",
    sessionSecret,
    secureCookie: true,
    now: () => now,
  }));
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function issueNonce(address = account.address) {
  const response = await fetch(`${baseUrl}/auth/nonce?address=${address}`);
  return { response, body: await response.json() as { messageToSign: string; nonce: string } };
}

async function signedVerify(message: string, signer = account) {
  const signature = await signer.signMessage({ message });
  return fetch(`${baseUrl}/auth/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
}

describe("wallet nonce and session auth", () => {
  it("issues a single-use nonce and rejects replay", async () => {
    const { body } = await issueNonce();
    const first = await signedVerify(body.messageToSign);
    expect(first.status).toBe(200);
    const nonce = /Nonce: ([A-Za-z0-9]+)/.exec(body.messageToSign)?.[1] ?? "";
    expect(database.prepare("SELECT expires_at FROM auth_nonces WHERE address = ? AND nonce = ?")
      .get(account.address.toLowerCase(), nonce)).toBeUndefined();
  });

  it("rejects a replayed signed message", async () => {
    const { body } = await issueNonce();
    expect((await signedVerify(body.messageToSign)).status).toBe(200);
    expect((await signedVerify(body.messageToSign)).status).toBe(401);
  });

  it("rejects a nonce after its five-minute expiry", async () => {
    const { body } = await issueNonce();
    now += 5 * 60 * 1000 + 1;
    const response = await signedVerify(body.messageToSign);
    expect(response.status).toBe(401);
  });

  it("rejects a message for the wrong chain ID", async () => {
    const { body } = await issueNonce();
    const wrongChainMessage = body.messageToSign.replace("Chain ID: 91562037", "Chain ID: 1");
    expect((await signedVerify(wrongChainMessage)).status).toBe(401);
  });

  it("rejects a signature from a different address", async () => {
    const { body } = await issueNonce();
    expect((await signedVerify(body.messageToSign, otherAccount)).status).toBe(401);
  });

  it("sets the session cookie with required flags and resolves its address", async () => {
    const { body } = await issueNonce();
    const response = await signedVerify(body.messageToSign);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${authSessionCookieName}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    const token = decodeURIComponent(cookie.split(";")[0].split("=").slice(1).join("="));
    const req = { headers: { cookie: `${authSessionCookieName}=${token}` }, header: () => undefined } as unknown as Request;
    expect(getCaller(req, { sessionSecret, devHeaderEnabled: false, now: () => now })).toBe(account.address);
  });

  it("ignores x-user-address when AUTH_DEV_HEADER is false", () => {
    const req = { headers: {}, header: (name: string) => name === "x-user-address" ? account.address : undefined } as unknown as Request;
    expect(getCaller(req, { sessionSecret, devHeaderEnabled: false, now: () => now })).toBeNull();
  });

  it("keeps SARAL fail-closed", async () => {
    const response = await fetch(`${baseUrl}/auth/saral`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: account.address, saralSessionProof: { opaque: true } }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { message: "SARAL not configured: awaiting mentor docs" },
    });
  });
});
