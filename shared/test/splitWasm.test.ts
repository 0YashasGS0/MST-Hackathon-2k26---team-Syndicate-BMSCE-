import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { computeBuyerBps, criterionScore, fulfilledFromCriteria, loadSplitWasm, type CriterionVerdict, type SplitWasm } from "../src";

const WASM_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/split.wasm");

let wasm: SplitWasm;
beforeAll(async () => {
  wasm = await loadSplitWasm(readFileSync(WASM_PATH));
});

const d = (...w: number[]) => w.map((weightBps, i) => ({ id: `D${i + 1}`, weightBps }));
const s = (...p: number[]) => p.map((fulfilledPct, i) => ({ id: `D${i + 1}`, fulfilledPct }));

// Deterministic PRNG (mulberry32) so a failure is reproducible.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** n positive integer weights summing to exactly 10000 (random cut points). */
function randomWeights(n: number, r: () => number): number[] {
  const cuts = new Set<number>();
  while (cuts.size < n - 1) cuts.add(1 + Math.floor(r() * 9999));
  const pts = [0, ...[...cuts].sort((a, b) => a - b), 10000];
  return pts.slice(1).map((p, i) => p - pts[i]);
}

describe("split.wasm parity with split.ts", () => {
  it("known cases: 3333/3333/3334 @50 → 4999; smoke 5000/3000/2000 @100/40/0 → 3800; roadmap → 3500", () => {
    for (const [w, p, want] of [
      [[3333, 3333, 3334], [50, 50, 50], 4999],
      [[5000, 3000, 2000], [100, 40, 0], 3800],
      [[5000, 3000, 2000], [100, 50, 0], 3500],
      [[10000], [0], 10000],
      [[10000], [100], 0],
    ] as [number[], number[], number][]) {
      expect(computeBuyerBps(d(...w), s(...p))).toBe(want);
      expect(wasm.computeBuyerBps(d(...w), s(...p))).toBe(want);
    }
  });

  it("500 random valid cases: TS and WASM identical", () => {
    const r = rng(20260929);
    let mismatches = 0;
    for (let c = 0; c < 500; c++) {
      const n = 1 + Math.floor(r() * 20);
      const weights = randomWeights(n, r);
      const pcts = weights.map(() => Math.floor(r() * 101));
      const deliverables = d(...weights);
      // shuffle score order to exercise id matching
      const scores = s(...pcts).sort(() => r() - 0.5);
      const ts = computeBuyerBps(deliverables, scores);
      const wa = wasm.computeBuyerBps(deliverables, scores);
      if (ts !== wa) mismatches++;
      expect(wa, `case ${c}: w=${weights} p=${pcts}`).toBe(ts);
      expect(ts).toBeGreaterThanOrEqual(0);
      expect(ts).toBeLessThanOrEqual(10000);
    }
    expect(mismatches).toBe(0);
  });

  it("the WASM wrapper applies the same validation", () => {
    expect(() => wasm.computeBuyerBps(d(5000, 5000), s(100))).toThrow(/missing score for deliverable D2/);
    expect(() => wasm.computeBuyerBps(d(5000, 5000), [...s(100, 0), { id: "D1", fulfilledPct: 1 }])).toThrow(/duplicate/);
    expect(() => wasm.computeBuyerBps(d(5000, 5000), s(50.5, 0))).toThrow(/integer from 0 to 100/);
    expect(() => wasm.computeBuyerBps(d(5000, 4000), s(0, 0))).toThrow(/sum to 10000/);
  });

  it("accepts an ArrayBuffer as well as a Uint8Array", async () => {
    const buf = readFileSync(WASM_PATH);
    const w2 = await loadSplitWasm(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(w2.computeBuyerBps(d(3333, 3333, 3334), s(50, 50, 50))).toBe(4999);
  });
});

describe("split.wasm parity — criterion maths", () => {
  it("known cases", () => {
    const a: CriterionVerdict[] = [{ index: 0, verdict: "partial", satisfied: 12, total: 20 }, { index: 1, verdict: "partial", satisfied: 8, total: 12 }];
    expect(wasm.fulfilledFromCriteria(a, 2)).toBe(63);
    expect(wasm.criterionScore({ index: 0, verdict: "partial", satisfied: 8, total: 12 })).toBe(66);
    expect(wasm.criterionScore({ index: 0, verdict: "met" })).toBe(100);
    expect(wasm.criterionScore({ index: 0, verdict: "not_met" })).toBe(0);
  });

  it("500 random verdict sets: TS and WASM identical", () => {
    const r = rng(424242);
    const kinds = ["met", "partial", "not_met"] as const;
    for (let c = 0; c < 500; c++) {
      const n = 1 + Math.floor(r() * 8);
      const verdicts: CriterionVerdict[] = Array.from({ length: n }, (_, index) => {
        const verdict = kinds[Math.floor(r() * 3)];
        if (verdict !== "partial") return { index, verdict };
        const total = 1 + Math.floor(r() * 50);
        return { index, verdict, satisfied: Math.floor(r() * (total + 1)), total };
      });
      const shuffled = [...verdicts].sort(() => r() - 0.5);
      const ts = fulfilledFromCriteria(shuffled, n);
      expect(wasm.fulfilledFromCriteria(shuffled, n), `case ${c}: ${JSON.stringify(verdicts)}`).toBe(ts);
      for (const v of verdicts) expect(wasm.criterionScore(v)).toBe(criterionScore(v));
      expect(ts).toBeGreaterThanOrEqual(0);
      expect(ts).toBeLessThanOrEqual(100);
    }
  });

  it("the WASM wrapper applies the same verdict validation", () => {
    expect(() => wasm.fulfilledFromCriteria([{ index: 0, verdict: "met" }], 2)).toThrow(/missing verdict/);
    expect(() => wasm.criterionScore({ index: 0, verdict: "partial" })).toThrow(/needs integer satisfied and total/);
  });
});

