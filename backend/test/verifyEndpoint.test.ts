import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { hashJson, hashSow, type Sow } from "@kernel-exploits/shared";
import { createDisputeRouter, type DealReader, type SettledReader } from "../src/sow";
import { SowStore } from "../src/sow/store";
import { scoreDispute } from "../src/agent";
import type { LlmClient } from "../src/agent/llm";

const sow: Sow = {
  version: "sow/v1",
  title: "Bakery landing page",
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  token: "0x3333333333333333333333333333333333333333",
  amount: "100000000",
  deliveryDeadline: 1_800_000_000,
  reviewWindowSecs: 86400,
  deliverables: [
    { id: "D1", title: "Homepage", description: "h", acceptanceCriteria: ["mobile"], weightBps: 5000 },
    { id: "D2", title: "Menu", description: "m", acceptanceCriteria: ["20 items"], weightBps: 3000 },
    { id: "D3", title: "Contact", description: "c", acceptanceCriteria: ["email"], weightBps: 2000 },
  ],
  exclusions: [],
};
const DEAL_ID = 7;
const llm: LlmClient = {
  model: "mock-model",
  provider: "mock",
  callTool: async () => ({
    scores: [
      { id: "D1", fulfilledPct: 100, rationale: "ok", evidenceRefs: [] },
      { id: "D2", fulfilledPct: 40, rationale: "12/20", evidenceRefs: [] },
      { id: "D3", fulfilledPct: 0, rationale: "no email", evidenceRefs: [] },
    ],
  }),
};

/** A linked draft whose approved SOW is `sow`, plus a real stored ruling from scoreDispute. */
async function seeded() {
  const store = new SowStore(":memory:");
  const now = 1;
  const draft = store.createDraft({ buyer: sow.buyer, seller: sow.seller, purpose: "p", buyerConstraints: "c", amount: sow.amount, deliveryDeadline: sow.deliveryDeadline, reviewWindowSecs: sow.reviewWindowSecs }, now);
  store.addVersion(draft.id, JSON.stringify(sow), hashSow(sow), [], now);
  store.setStatus(draft.id, "approved", now);
  store.link(draft.id, DEAL_ID, "0x" + "ab".repeat(32), now);
  const ruling = await scoreDispute(
    { dealId: DEAL_ID, sow, sowHash: hashSow(sow), deliveryHash: "0x" + "aa".repeat(32), evidenceHash: "0x" + "bb".repeat(32), complaint: "c", deliveryNotes: "d", evidenceNotes: "e" },
    { llm, store, demoFallback: false, promptVersion: "v1", now: () => now },
  );
  return { store, ruling };
}

function app(store: SowStore, readDeal: DealReader) {
  const a = express();
  a.use(createDisputeRouter({ store, readDeal }));
  return a;
}
const chain = (reasoningHash: string, proposedBuyerBps: number, status = 6): DealReader => async () => ({ reasoningHash: reasoningHash as `0x${string}`, proposedBuyerBps, status });

describe("GET /deals/:id/verify", () => {
  it("ok for a stored ruling whose on-chain hash matches (incl. WASM check)", async () => {
    const { store, ruling } = await seeded();
    const res = await request(app(store, chain(ruling.reasoningHash, ruling.buyerBps))).get(`/deals/${DEAL_ID}/verify`).expect(200);
    expect(res.body).toMatchObject({
      dealId: DEAL_ID,
      source: "agent",
      verifiable: true,
      onchain: { reasoningHash: ruling.reasoningHash, proposedBuyerBps: 3800, status: "ResolutionProposed" },
      result: { ok: true, hashMatches: true, bpsMatchesFormula: true, bpsMatchesOnchain: true, wasmMatchesTs: true, sowMatches: true, recomputedBps: 3800 },
    });
    expect(res.body.sow).toEqual(sow);
    expect(hashJson(res.body.reasoning)).toBe(ruling.reasoningHash);
  });

  it("detects a DB-tampered ruling (hash mismatch)", async () => {
    const { store, ruling } = await seeded();
    const row = store.db.prepare("SELECT reasoning_json FROM dispute_rulings WHERE reasoning_hash = ?").get(ruling.reasoningHash) as { reasoning_json: string };
    const tampered = JSON.parse(row.reasoning_json);
    tampered.scores[1].fulfilledPct = 90;
    tampered.buyerBps = 2300; // tamperer even keeps the formula consistent
    store.db.prepare("UPDATE dispute_rulings SET reasoning_json = ? WHERE reasoning_hash = ?").run(JSON.stringify(tampered), ruling.reasoningHash);
    const res = await request(app(store, chain(ruling.reasoningHash, 3800))).get(`/deals/${DEAL_ID}/verify`).expect(200);
    expect(res.body.result).toMatchObject({ ok: false, hashMatches: false, bpsMatchesFormula: true, bpsMatchesOnchain: false });
  });

  it("detects an on-chain proposedBuyerBps that differs from the formula", async () => {
    const { store, ruling } = await seeded();
    const res = await request(app(store, chain(ruling.reasoningHash, 9000))).get(`/deals/${DEAL_ID}/verify`).expect(200);
    expect(res.body.result).toMatchObject({ ok: false, hashMatches: true, bpsMatchesFormula: true, bpsMatchesOnchain: false });
  });

  it("404 when there is no ruling on-chain yet, or no deal", async () => {
    const { store } = await seeded();
    const none = await request(app(store, chain("0x" + "00".repeat(32), 0, 5))).get(`/deals/${DEAL_ID}/verify`).expect(404);
    expect(none.body.error).toEqual({ code: "NoRuling", message: "no ruling" });
    const missing = await request(app(store, chain("0x" + "00".repeat(32), 0, 0))).get("/deals/999/verify").expect(404);
    expect(missing.body.error.code).toBe("NotFound");
  });

  it("an on-chain hash we never stored → arbitrator-or-unknown, not verifiable", async () => {
    const { store } = await seeded();
    const res = await request(app(store, chain("0x" + "ee".repeat(32), 3800, 10))).get(`/deals/${DEAL_ID}/verify`).expect(200);
    expect(res.body).toEqual({
      dealId: DEAL_ID,
      source: "arbitrator-or-unknown",
      verifiable: false,
      onchain: { reasoningHash: "0x" + "ee".repeat(32), proposedBuyerBps: 3800, status: "Resolved" },
    });
  });

  it("400 on a non-numeric id; 502 when the chain can't be read", async () => {
    const { store } = await seeded();
    await request(app(store, chain("0x" + "00".repeat(32), 0))).get("/deals/abc/verify").expect(400);
    const down: DealReader = async () => {
      throw new Error("fetch failed");
    };
    const res = await request(app(store, down)).get(`/deals/${DEAL_ID}/verify`).expect(502);
    expect(res.body.error.code).toBe("ChainUnavailable");
  });
});

describe("GET /deals/:id/verify — arbitrator rulings (Settled event)", () => {
  async function withArbitrator(buyerBps: number) {
    const { store } = await seeded();
    const arb = { source: "arbitrator" as const, dealId: DEAL_ID, sowHash: hashSow(sow), buyerBps, ruling: "Menu incomplete, form broken.", arbitrator: "0x4444444444444444444444444444444444444444" };
    const hash = store.saveRuling(arb, 1); // what B1 stores before it calls arbitrate(id, bps, hash)
    expect(hash).toBe(hashJson(arb));
    return { store, hash };
  }
  // arbitrate() leaves proposedBuyerBps at the agent's stale 3800; status Resolved (10).
  const resolved = (hash: string): DealReader => async () => ({ reasoningHash: hash as `0x${string}`, proposedBuyerBps: 3800, status: 10 });
  const settledWith = (toBuyer: bigint, toSeller: bigint): SettledReader => async () => ({ toBuyer, toSeller });

  it("matching Settled event → ok, stale proposedBuyerBps ignored", async () => {
    const { store, hash } = await withArbitrator(6000);
    const a = express();
    a.use(createDisputeRouter({ store, readDeal: resolved(hash), readSettled: settledWith(60_000_000n, 40_000_000n) }));
    const res = await request(a).get(`/deals/${DEAL_ID}/verify`).expect(200);
    expect(res.body).toMatchObject({
      source: "arbitrator",
      verifiable: true,
      onchain: { status: "Resolved", proposedBuyerBps: 3800, settled: { toBuyer: "60000000", toSeller: "40000000" } },
      result: { source: "arbitrator", ok: true, hashMatches: true, settledMatches: true, bpsMatchesOnchain: null, bpsMatchesFormula: null, sowMatches: true },
    });
  });

  it("Settled toBuyer that doesn't match the ruling → not ok", async () => {
    const { store, hash } = await withArbitrator(6000);
    const a = express();
    a.use(createDisputeRouter({ store, readDeal: resolved(hash), readSettled: settledWith(38_000_000n, 62_000_000n) }));
    const res = await request(a).get(`/deals/${DEAL_ID}/verify`).expect(200);
    expect(res.body.result).toMatchObject({ ok: false, settledMatches: false, hashMatches: true });
  });

  it("an agent ruling still checks on-chain proposedBuyerBps (and Settled when Resolved)", async () => {
    const { store, ruling } = await seeded();
    const a = express();
    a.use(createDisputeRouter({ store, readDeal: async () => ({ reasoningHash: ruling.reasoningHash as `0x${string}`, proposedBuyerBps: 3800, status: 10 }), readSettled: settledWith(38_000_000n, 62_000_000n) }));
    const res = await request(a).get(`/deals/${DEAL_ID}/verify`).expect(200);
    expect(res.body.result).toMatchObject({ source: "agent", ok: true, bpsMatchesOnchain: true, settledMatches: true, bpsMatchesFormula: true });
  });

  it("Resolved deal without a Settled reader configured → 502 (router still constructs)", async () => {
    const { store, hash } = await withArbitrator(6000);
    const saved = { ...process.env };
    delete process.env.MST_RPC_URL;
    delete process.env.ESCROW_ADDRESS;
    try {
      const a = express();
      a.use(createDisputeRouter({ store, readDeal: resolved(hash) }));
      const res = await request(a).get(`/deals/${DEAL_ID}/verify`).expect(502);
      expect(res.body.error.message).toMatch(/no Settled reader configured/);
    } finally {
      process.env = saved;
    }
  });
});

describe("createDisputeRouter env fail-fast", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("throws at construction when ESCROW_ADDRESS or MST_RPC_URL is missing (no injected reader)", () => {
    process.env.MST_RPC_URL = "https://testnetrpc.mstblockchain.com";
    delete process.env.ESCROW_ADDRESS;
    expect(() => createDisputeRouter({ store: new SowStore(":memory:") })).toThrow("createDisputeRouter: missing required env ESCROW_ADDRESS");
    process.env.ESCROW_ADDRESS = "0x5555555555555555555555555555555555555555";
    delete process.env.MST_RPC_URL;
    expect(() => createDisputeRouter({ store: new SowStore(":memory:") })).toThrow("createDisputeRouter: missing required env MST_RPC_URL");
    process.env.MST_RPC_URL = "https://testnetrpc.mstblockchain.com";
    expect(() => createDisputeRouter({ store: new SowStore(":memory:") })).not.toThrow(); // also proves split.wasm resolves from disk
  });
});
