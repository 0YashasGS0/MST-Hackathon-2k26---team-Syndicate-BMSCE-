import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { computeBuyerBps, hashJson, hashSow, loadSplitWasm, verifyRuling, type ArbitratorReasoning, type Reasoning, type Sow, type SplitWasm } from "../src";

const WASM_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/split.wasm");

let wasm: SplitWasm;
beforeAll(async () => {
  wasm = await loadSplitWasm(readFileSync(WASM_PATH));
});

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
const scores = [
  { id: "D1", fulfilledPct: 100, rationale: "ok", evidenceRefs: [] },
  { id: "D2", fulfilledPct: 40, rationale: "12/20", evidenceRefs: ["evidence_notes"] },
  { id: "D3", fulfilledPct: 0, rationale: "no email", evidenceRefs: ["evidence_notes"] },
];
const reasoning: Reasoning = {
  dealId: 1,
  sowHash: hashSow(sow),
  deliveryHash: "0x" + "aa".repeat(32),
  evidenceHash: "0x" + "bb".repeat(32),
  scores,
  buyerBps: computeBuyerBps(sow.deliverables, scores), // 3800
  model: "gemini-2.5-flash",
  promptVersion: "v1",
};
const onchainHash = hashJson(reasoning);
const clone = <T>(v: T): T => structuredClone(v);

describe("verifyRuling", () => {
  it("clean pass: every check true (with WASM and on-chain bps)", () => {
    const r = verifyRuling({ reasoning, onchainReasoningHash: onchainHash.toUpperCase().replace("0X", "0x"), onchainProposedBps: 3800, sow, wasm });
    expect(r).toEqual({
      source: "agent", hashMatches: true, bpsMatchesFormula: true, bpsMatchesOnchain: true, settledMatches: null, wasmMatchesTs: true, sowMatches: true,
      recomputedHash: onchainHash, recomputedBps: 3800, ok: true,
    });
  });

  it("checks that weren't supplied are null and don't fail ok", () => {
    const r = verifyRuling({ reasoning, onchainReasoningHash: onchainHash, sow });
    expect(r).toMatchObject({ bpsMatchesOnchain: null, wasmMatchesTs: null, ok: true });
  });

  it("tampered score → hash and formula both fail", () => {
    const t = clone(reasoning);
    t.scores[1].fulfilledPct = 90;
    const r = verifyRuling({ reasoning: t, onchainReasoningHash: onchainHash, onchainProposedBps: 3800, sow, wasm });
    expect(r).toMatchObject({ hashMatches: false, bpsMatchesFormula: false, recomputedBps: 2300, wasmMatchesTs: true, ok: false });
  });

  it("tampered buyerBps → hash, formula and on-chain all fail", () => {
    const t = { ...clone(reasoning), buyerBps: 5000 };
    const r = verifyRuling({ reasoning: t, onchainReasoningHash: onchainHash, onchainProposedBps: 3800, sow, wasm });
    expect(r).toMatchObject({ hashMatches: false, bpsMatchesFormula: false, bpsMatchesOnchain: false, recomputedBps: 3800, ok: false });
  });

  it("tampered model field → only the hash fails", () => {
    const t = { ...clone(reasoning), model: "gemini-9-ultra" };
    const r = verifyRuling({ reasoning: t, onchainReasoningHash: onchainHash, onchainProposedBps: 3800, sow, wasm });
    expect(r).toMatchObject({ hashMatches: false, bpsMatchesFormula: true, bpsMatchesOnchain: true, sowMatches: true, ok: false });
  });

  it("wrong on-chain hash → fails", () => {
    const r = verifyRuling({ reasoning, onchainReasoningHash: "0x" + "00".repeat(32), sow, wasm });
    expect(r).toMatchObject({ hashMatches: false, ok: false });
  });

  it("swapped SOW (same ids, different terms) → sowMatches fails", () => {
    const other = { ...clone(sow), amount: "999000000" };
    const r = verifyRuling({ reasoning, onchainReasoningHash: onchainHash, sow: other, wasm });
    expect(r).toMatchObject({ hashMatches: true, bpsMatchesFormula: true, sowMatches: false, ok: false });
  });

  it("scores that don't fit the SOW → recomputedBps null, formula and wasm checks fail", () => {
    const t = clone(reasoning);
    t.scores[2].id = "D9";
    const r = verifyRuling({ reasoning: t, onchainReasoningHash: hashJson(t), sow, wasm });
    expect(r).toMatchObject({ hashMatches: true, recomputedBps: null, bpsMatchesFormula: false, wasmMatchesTs: false, ok: false });
  });
});

describe("verifyRuling — arbitrator rulings and settlement", () => {
  const arb: ArbitratorReasoning = {
    source: "arbitrator",
    dealId: 1,
    sowHash: hashSow(sow),
    buyerBps: 6000,
    ruling: "Menu and form not delivered as specified; 60% refund.",
    arbitrator: "0x4444444444444444444444444444444444444444",
  };
  const arbHash = hashJson(arb);

  it("matching Settled event → ok; formula, on-chain bps and wasm checks don't apply", () => {
    // proposedBuyerBps on-chain is still the agent's stale 3800 — must be ignored for arbitrator rulings.
    const r = verifyRuling({ reasoning: arb, onchainReasoningHash: arbHash, onchainProposedBps: 3800, settled: { toBuyer: 60_000_000n, amount: "100000000" }, sow, wasm });
    expect(r).toEqual({
      source: "arbitrator", hashMatches: true, bpsMatchesFormula: null, bpsMatchesOnchain: null, settledMatches: true, wasmMatchesTs: null,
      sowMatches: true, recomputedHash: arbHash, recomputedBps: null, ok: true,
    });
  });

  it("settlement rounding mirrors the contract: floor(amount × bps / 10000)", () => {
    const odd = { ...arb, buyerBps: 3333 };
    const r = verifyRuling({ reasoning: odd, onchainReasoningHash: hashJson(odd), settled: { toBuyer: "33", amount: "101" }, sow }); // 101×3333/10000 = 33.66 → 33
    expect(r.settledMatches).toBe(true);
  });

  it("mismatched toBuyer → not ok", () => {
    const r = verifyRuling({ reasoning: arb, onchainReasoningHash: arbHash, settled: { toBuyer: "38000000", amount: "100000000" }, sow });
    expect(r).toMatchObject({ settledMatches: false, hashMatches: true, ok: false });
  });

  it("tampered arbitrator JSON → hash fails", () => {
    const r = verifyRuling({ reasoning: { ...arb, buyerBps: 9000 }, onchainReasoningHash: arbHash, sow });
    expect(r).toMatchObject({ hashMatches: false, ok: false });
  });

  it("an agent ruling still checks on-chain bps (and settlement, if given)", () => {
    const bad = verifyRuling({ reasoning, onchainReasoningHash: onchainHash, onchainProposedBps: 6000, sow });
    expect(bad).toMatchObject({ source: "agent", bpsMatchesOnchain: false, ok: false });
    const settled = verifyRuling({ reasoning, onchainReasoningHash: onchainHash, onchainProposedBps: 3800, settled: { toBuyer: "38000000", amount: "100000000" }, sow });
    expect(settled).toMatchObject({ bpsMatchesOnchain: true, settledMatches: true, ok: true });
  });

  it("agent reasoning without `source` hashes exactly as before (no field added)", () => {
    expect("source" in reasoning).toBe(false);
    expect(hashJson(reasoning)).toBe(onchainHash);
  });
});

