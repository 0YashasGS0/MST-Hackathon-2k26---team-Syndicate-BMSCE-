// Security regression tests against the real app stack (createApp). Only the chain client is mocked.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x9999999999999999999999999999999999999999";
const API_KEY = "test-api-key-0123456789";
const ADMIN = "test-admin-token-0123456789abcdef";

vi.hoisted(() => {
  const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "sec-db-"));
  Object.assign(process.env, {
    DB_PATH: `${dir}/app.db`,
    BACKEND_API_KEY: "test-api-key-0123456789",
    ADMIN_TOKEN: "test-admin-token-0123456789abcdef",
    USD_ADDRESS: "0x3333333333333333333333333333333333333333",
    ESCROW_ADDRESS: "0x4444444444444444444444444444444444444444",
    MST_RPC_URL: "https://rpc.invalid",
    AGENT_DEMO_FALLBACK: "true",
    RATE_LIMIT_EXPENSIVE_PER_MIN: "3",
  });
});

// On-chain deal 7: BUYER ↔ SELLER, status Funded. Anything else: "None" (not found).
vi.mock("../src/chain", () => ({
  escrowAbi: [],
  usdAbi: [],
  mst: {},
  org: undefined,
  agent: undefined,
  arbitrator: undefined,
  ESCROW: "0x4444444444444444444444444444444444444444",
  USD: "0x3333333333333333333333333333333333333333",
  sendContractTx: vi.fn(),
  pub: {
    getBlockNumber: vi.fn(async () => 1n),
    readContract: vi.fn(async ({ args }: { args: [bigint] }) =>
      args[0] === 7n ? { buyer: BUYER, seller: SELLER, status: 3 } : { buyer: "0x" + "0".repeat(40), seller: "0x" + "0".repeat(40), status: 0 },
    ),
  },
}));

import { createApp } from "../src/app";
import { configProblems } from "../src/security";

let app: ReturnType<typeof createApp>;
beforeAll(() => {
  app = createApp();
});
afterEach(() => vi.unstubAllEnvs());

const as = (who: string) => ({ "x-api-key": API_KEY, "x-user-address": who });
const uploadsDir = join(__dirname, "..", "data", "uploads");
const countUploads = () => readdirSync(uploadsDir).length;

describe("HTTP hardening", () => {
  it("sends security headers and hides the framework", async () => {
    const res = await request(app).get("/no-such-route");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NotFound", message: "no such route" } });
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("CORS: only allowlisted origins get credentialed access", async () => {
    const ok = await request(app).options("/drafts").set("origin", "http://localhost:3000").set("access-control-request-method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await request(app).options("/drafts").set("origin", "https://evil.example").set("access-control-request-method", "POST");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("malformed and oversized JSON get generic 4xx, never a stack trace", async () => {
    const bad = await request(app).post("/arbitrator/deals/7/rule").set("content-type", "application/json").send("{oops");
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.ts|node_modules/);
    const big = await request(app).post("/arbitrator/deals/7/rule").set("content-type", "application/json").send(JSON.stringify({ x: "a".repeat(200_000) }));
    expect(big.status).toBe(413);
  });
});

describe("operator actions need the admin token (not the public API key)", () => {
  it("KYC approval: API key alone → 401; wrong token → 401; right token passes auth", async () => {
    const path = `/admin/kyc/${BUYER}/approve`;
    expect((await request(app).post(path).set("x-api-key", API_KEY)).status).toBe(401);
    expect((await request(app).post(path).set("x-admin-token", "nope")).status).toBe(401);
    const ok = await request(app).post(path).set("x-admin-token", ADMIN);
    expect(ok.status).toBe(500); // past auth; the mocked chain has no ORG wallet
    expect(ok.body.error.code).toBe("CHAIN_UNCONFIGURED");
  });

  it("arbitrator case list: admin token only", async () => {
    expect((await request(app).get("/arbitrator/cases").set("x-api-key", API_KEY)).status).toBe(401);
    expect((await request(app).get("/arbitrator/cases").set("x-admin-token", ADMIN)).status).toBe(200);
  });
});

describe("uploads: identity, party checks, limits", () => {
  it("KYC submit: must be signed in, only for your own wallet; rejected files are not kept", async () => {
    expect((await request(app).post("/kyc/submit").set("x-api-key", API_KEY).attach("file", Buffer.from("x"), { filename: "a.png", contentType: "image/png" })).status).toBe(401);
    const before = countUploads();
    const other = await request(app).post("/kyc/submit").set(as(STRANGER)).field("address", BUYER).attach("file", Buffer.from("x"), { filename: "a.png", contentType: "image/png" });
    expect(other.status).toBe(403);
    expect(countUploads()).toBe(before);
    const own = await request(app).post("/kyc/submit").set(as(BUYER)).attach("file", Buffer.from("x"), { filename: "a.png", contentType: "image/png" });
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ address: BUYER, kycLevel: 1 });
  });

  it("rejects oversized files (413) and disallowed types (400)", async () => {
    const huge = await request(app).post("/kyc/submit").set(as(SELLER)).attach("file", Buffer.alloc(10 * 1024 * 1024 + 1), { filename: "big.png", contentType: "image/png" });
    expect(huge.status).toBe(413);
    const exe = await request(app).post("/kyc/submit").set(as(SELLER)).attach("file", Buffer.from("MZ"), { filename: "x.exe", contentType: "application/x-msdownload" });
    expect(exe.status).toBe(400);
  });

  it("delivery: seller only; evidence: parties only — checked on-chain before anything is written", async () => {
    const before = countUploads();
    const png = { filename: "d.png", contentType: "image/png" };
    expect((await request(app).post("/deals/7/delivery").set(as(BUYER)).attach("files", Buffer.from("x"), png)).status).toBe(403);
    expect((await request(app).post("/deals/7/evidence").set(as(STRANGER)).attach("files", Buffer.from("x"), png)).status).toBe(403);
    expect((await request(app).post("/deals/8/evidence").set(as(BUYER)).attach("files", Buffer.from("x"), png)).status).toBe(404);
    expect((await request(app).post("/deals/7/evidence").set("x-api-key", API_KEY).attach("files", Buffer.from("x"), png)).status).toBe(401);
    expect(countUploads()).toBe(before);
    const empty = await request(app).post("/deals/7/delivery").set(as(SELLER)); // no body at all (Express 5: req.body undefined)
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe("BAD_REQUEST");
    const ok = await request(app).post("/deals/7/delivery").set(as(SELLER)).attach("files", Buffer.from("site.zip bytes"), png);
    expect(ok.status).toBe(200);
    expect(ok.body.hash).toMatch(/^0x[0-9a-f]{64}$/);
    const stored = readdirSync(uploadsDir);
    expect(stored.every((f) => /^[0-9a-f]{32}$/.test(f))).toBe(true); // random names, never the client's
  });
});

describe("expensive routes", () => {
  it("dispute scoring is for the deal's parties only", async () => {
    const fresh = createApp(); // own limiter budget (the expensive-route limit is shared across those routes)
    expect((await request(fresh).post("/deals/7/resolve").set(as(STRANGER))).status).toBe(403);
    expect((await request(fresh).post("/deals/7/resolve").set("x-api-key", API_KEY)).status).toBe(401);
  });

  it("are rate-limited per IP (429 with a JSON error)", async () => {
    const fresh = createApp();
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await request(fresh).post("/deals/7/timeout").set(as(STRANGER))).status);
    expect(codes.slice(0, 3).every((c) => c === 403)).toBe(true);
    const limited = await request(fresh).post("/deals/7/timeout").set(as(STRANGER));
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RateLimited");
  });
});

describe("production configuration guard", () => {
  const good = {
    NODE_ENV: "production",
    AUTH_SESSION_SECRET: "k".repeat(16) + "Zq93-random-session-secret-xx",
    BACKEND_API_KEY: "Zq93randomApiKey1234",
    ADMIN_TOKEN: "Zq93random-admin-token-abcdef12",
    AUTH_DOMAIN: "app.example.com",
    CORS_ORIGINS: "https://app.example.com",
  };

  it("accepts a safe config and ignores non-production", () => {
    expect(configProblems(good)).toEqual([]);
    expect(configProblems({ NODE_ENV: "development", AUTH_DEV_HEADER: "true" })).toEqual([]);
  });

  it("rejects dev auth, weak or missing secrets, wildcard CORS and demo fallbacks", () => {
    const p = configProblems({ ...good, AUTH_DEV_HEADER: "true", ADMIN_TOKEN: "change-me-admin-token-xxxxxxxx", BACKEND_API_KEY: "", CORS_ORIGINS: "*", AGENT_DEMO_FALLBACK: "true", AUTH_SESSION_SECRET: "short" }).join("\n");
    for (const m of ["AUTH_DEV_HEADER", "ADMIN_TOKEN", "BACKEND_API_KEY", "CORS_ORIGINS", "AGENT_DEMO_FALLBACK", "AUTH_SESSION_SECRET"]) expect(p).toContain(m);
  });

  it("createApp refuses to start with an unsafe production config", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_DEV_HEADER", "true");
    expect(() => createApp()).toThrow(/Unsafe production configuration/);
  });
});

// keep the temp-dir helpers referenced (vi.hoisted runs before imports)
void mkdtempSync;
void tmpdir;
