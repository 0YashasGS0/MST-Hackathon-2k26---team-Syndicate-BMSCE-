// Merge-plan items 1–3: injected identity (PG semantics), SowStore on B1's connection or a path, the store method
// names B1 calls, and minimal arbitrator rulings that save, hash and verify.
import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashJson, hashSow, verifyRuling, type Sow } from "@kernel-exploits/shared";
import { createSowRouter, getCaller, SowStore } from "../src/sow";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const USD = "0x3333333333333333333333333333333333333333";
const sow: Sow = {
  version: "sow/v1",
  title: "Bakery landing page",
  buyer: BUYER,
  seller: SELLER,
  token: USD,
  amount: "100000000",
  deliveryDeadline: 1_800_000_000,
  reviewWindowSecs: 86400,
  deliverables: [
    { id: "D1", title: "Homepage", description: "h", acceptanceCriteria: ["mobile"], weightBps: 6000 },
    { id: "D2", title: "Menu", description: "m", acceptanceCriteria: ["20 items"], weightBps: 4000 },
  ],
  exclusions: [],
};
const legacyDraft = { buyer: BUYER, seller: SELLER, purpose: "p", buyerConstraints: "c", amount: "1", deliveryDeadline: 4_000_000_000, reviewWindowSecs: 60 };
const routerApp = (deps: Parameters<typeof createSowRouter>[0]) =>
  express().use(createSowRouter({ usdAddress: USD, verifyLink: async () => ({ ok: true }), demoFallback: true, ...deps }));
const fakeReq = (headers: Record<string, string>) => ({ header: (n: string) => headers[n.toLowerCase()] }) as unknown as express.Request;

afterEach(() => vi.unstubAllEnvs());

describe("identity (merge plan 1)", () => {
  it("default getCaller returns null without AUTH_DEV_HEADER=true, even with a valid header", () => {
    vi.stubEnv("AUTH_DEV_HEADER", "");
    expect(getCaller(fakeReq({ "x-user-address": BUYER }))).toBeNull();
    vi.stubEnv("AUTH_DEV_HEADER", "1"); // only the exact string "true" enables it
    expect(getCaller(fakeReq({ "x-user-address": BUYER }))).toBeNull();
  });

  it("default getCaller trusts x-user-address (lowercased) only with AUTH_DEV_HEADER=true", () => {
    vi.stubEnv("AUTH_DEV_HEADER", "true");
    expect(getCaller(fakeReq({ "x-user-address": BUYER.replace("0x1", "0xA") }))).toBe(BUYER.replace("0x1", "0xa"));
    expect(getCaller(fakeReq({ "x-user-address": "not-an-address" }))).toBeNull();
    expect(getCaller(fakeReq({}))).toBeNull();
  });

  it("without AUTH_DEV_HEADER the router answers 401 Unauthorized", async () => {
    vi.stubEnv("AUTH_DEV_HEADER", "false");
    const res = await request(routerApp({ store: new SowStore(":memory:") })).post("/drafts").set("x-user-address", BUYER).send(legacyDraft);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: "Unauthorized", message: expect.any(String) } });
  });

  it("an injected getCaller is the only identity source (header ignored; checksummed result lowercased)", async () => {
    const seen: string[] = [];
    const app = routerApp({
      store: new SowStore(":memory:"),
      getCaller: (req) => (seen.push(req.path), "0x1111111111111111111111111111111111111111".toUpperCase().replace("0X", "0x")),
    });
    await request(app).post("/drafts").set("x-user-address", SELLER).send(legacyDraft).expect(201);
    expect(seen).toEqual(["/drafts"]);
    const none = routerApp({ store: new SowStore(":memory:"), getCaller: () => null });
    expect((await request(none).post("/drafts").set("x-user-address", BUYER).send(legacyDraft)).status).toBe(401);
  });
});

describe("SowStore on B1's connection or a path (merge plan 2)", () => {
  const b2Tables = ["agent_calls", "dispute_rulings", "drafts", "sow_versions"];
  const tables = (db: Database.Database) =>
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[]).map((r) => r.name);

  it("from a Database instance: creates only B2's tables, leaves B1's tables and pragmas alone", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE chain_events (id INTEGER PRIMARY KEY)`); // B1's
    db.pragma("foreign_keys = OFF"); // B1's choice (better-sqlite3 defaults to ON); the store must not change it
    const store = new SowStore(db);
    expect(store.db).toBe(db);
    expect(tables(db)).toEqual(["agent_calls", "chain_events", "dispute_rulings", "drafts", "sow_versions"]);
    expect(db.pragma("foreign_keys", { simple: true })).toBe(0);
    const d = store.createDraft(legacyDraft, 1);
    expect(new SowStore(db).getDraft(d.id)?.purpose).toBe("p"); // a second store on the same connection sees it
  });

  it("from a path (and DB_PATH by default): opens the file, and a router given only { db: path } works", async () => {
    const dir = mkdtempSync(join(tmpdir(), "b2-store-"));
    try {
      const path = join(dir, "nested", "app.sqlite");
      const store = new SowStore(path);
      expect(tables(store.db)).toEqual(b2Tables);
      store.db.close();

      vi.stubEnv("DB_PATH", join(dir, "env.sqlite"));
      expect(new SowStore().db.name).toBe(join(dir, "env.sqlite"));

      const app = routerApp({ db: path });
      const created = await request(app).post("/drafts").set("x-user-address", BUYER).send(legacyDraft).expect(201);
      const reopened = new SowStore(new Database(path));
      expect(reopened.getDraft(created.body.id)?.buyer).toBe(BUYER);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("migrates an older DB (adds initiator, structured conflicts, signatures columns)", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE drafts (id TEXT PRIMARY KEY, buyer TEXT NOT NULL, seller TEXT NOT NULL, purpose TEXT NOT NULL,
      buyer_constraints TEXT NOT NULL, amount TEXT NOT NULL, delivery_deadline INTEGER NOT NULL, review_window_secs INTEGER NOT NULL,
      seller_points TEXT, status TEXT NOT NULL, deal_id INTEGER, link_tx_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE sow_versions (draft_id TEXT NOT NULL, version INTEGER NOT NULL, sow_json TEXT NOT NULL, sow_hash TEXT NOT NULL,
      conflicts_json TEXT NOT NULL DEFAULT '[]', buyer_approved INTEGER NOT NULL DEFAULT 0, seller_approved INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, PRIMARY KEY (draft_id, version));
      INSERT INTO drafts VALUES ('old', '${BUYER}', '${SELLER}', 'p', 'c', '1', 9, 9, NULL, 'awaiting_seller', NULL, NULL, 1, 1);
      INSERT INTO sow_versions (draft_id, version, sow_json, sow_hash, conflicts_json, created_at) VALUES ('old', 1, '{}', '0x', '["note"]', 1);`);
    const store = new SowStore(db);
    expect(store.getDraft("old")).toMatchObject({ initiator: "buyer", status: "awaiting_seller", buyerConstraints: "c" });
    expect(store.getVersion("old", 1)).toMatchObject({ conflictNotes: ["note"], conflicts: [], signatures: [] });
  });

  it("getSowForDeal(dealId) → { sow, sowHash, draftId } for a linked deal (number or string id), else null", () => {
    const store = new SowStore(":memory:");
    const d = store.createDraft(legacyDraft, 1);
    store.addVersion(d.id, JSON.stringify(sow), hashSow(sow), [], 1);
    expect(store.getSowForDeal(7)).toBeNull(); // not linked yet
    store.setStatus(d.id, "approved", 1);
    store.link(d.id, 7, "0x" + "ab".repeat(32), 1);
    const got = store.getSowForDeal(7);
    expect(got).toEqual({ sow, sowHash: hashSow(sow), draftId: d.id, version: 1 });
    expect(store.getSowForDeal("7")).toEqual(got);
    expect(store.getSowForDeal(7n)).toEqual(got);
    expect(store.getSowForDeal("x")).toBeNull();
    expect(store.getSowForDeal(8)).toBeNull();
  });
});

describe("rulings: saveRuling / getRuling, incl. the minimal arbitrator shape (merge plan 3)", () => {
  const minimal = () => ({ source: "arbitrator" as const, dealId: 7, sowHash: hashSow(sow), buyerBps: 2500, ruling: "Menu incomplete." });

  it("saves, hashes (hashJson) and returns the hash; getRuling reads it back in any hex case; idempotent", () => {
    const store = new SowStore(":memory:");
    const arb = minimal();
    const hash = store.saveRuling(arb);
    expect(hash).toBe(hashJson(arb));
    expect(store.getRuling(hash)).toEqual(arb);
    expect(store.getRuling(hash.toUpperCase().replace("0X", "0x"))).toEqual(arb);
    expect(store.saveRuling(arb, 99)).toBe(hash);
    expect((store.db.prepare(`SELECT COUNT(*) AS n FROM dispute_rulings`).get() as { n: number }).n).toBe(1);
    expect(store.getRuling("0x" + "00".repeat(32))).toBeUndefined();
  });

  it("the minimal arbitrator ruling verifies: hashMatches, sowMatches, settledMatches", () => {
    const store = new SowStore(":memory:");
    const hash = store.saveRuling(minimal());
    const stored = store.getRuling(hash)!;
    const r = verifyRuling({ reasoning: stored, onchainReasoningHash: hash, sow, settled: { toBuyer: 25_000_000n, amount: 100_000_000n } });
    expect(r).toMatchObject({ source: "arbitrator", ok: true, hashMatches: true, sowMatches: true, settledMatches: true, bpsMatchesFormula: null });
    const wrong = verifyRuling({ reasoning: stored, onchainReasoningHash: hash, sow, settled: { toBuyer: 30_000_000n, amount: 100_000_000n } });
    expect(wrong).toMatchObject({ ok: false, settledMatches: false });
  });

  it("extra arbitrator fields are kept and hashed; invalid rulings are rejected", () => {
    const store = new SowStore(":memory:");
    const withExtra = { ...minimal(), arbitrator: "0x4444444444444444444444444444444444444444" };
    expect(store.getRuling(store.saveRuling(withExtra))).toEqual(withExtra);
    const bad = (x: unknown) => () => store.saveRuling(x as never);
    expect(bad({ ...minimal(), buyerBps: 10_001 })).toThrow(/buyerBps/);
    expect(bad({ ...minimal(), ruling: "" })).toThrow(/invalid ruling/);
    expect(bad({ ...minimal(), sowHash: "0x12" })).toThrow(/sowHash/);
    expect(bad({ dealId: 1, sowHash: hashSow(sow), buyerBps: 1 })).toThrow(/invalid ruling/); // agent shape needs scores
  });
});
