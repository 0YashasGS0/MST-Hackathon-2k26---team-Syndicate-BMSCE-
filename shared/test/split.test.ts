import { describe, expect, it } from "vitest";
import { computeBuyerBps, criterionScore, fulfilledFromCriteria } from "../src";

const d = (...w: number[]) => w.map((weightBps, i) => ({ id: `D${i + 1}`, weightBps }));
const s = (...p: number[]) => p.map((fulfilledPct, i) => ({ id: `D${i + 1}`, fulfilledPct }));

describe("computeBuyerBps", () => {
  it("roadmap example: 5000/3000/2000 with 100/50/0 → 3500", () => {
    expect(computeBuyerBps(d(5000, 3000, 2000), s(100, 50, 0))).toBe(3500);
  });

  it("all delivered → 0; nothing delivered → 10000", () => {
    expect(computeBuyerBps(d(5000, 3000, 2000), s(100, 100, 100))).toBe(0);
    expect(computeBuyerBps(d(5000, 3000, 2000), s(0, 0, 0))).toBe(10000);
  });

  it("floors per deliverable: 3333/3333/3334 all at 50 → 1666 + 1666 + 1667 = 4999", () => {
    expect(computeBuyerBps(d(3333, 3333, 3334), s(50, 50, 50))).toBe(4999);
  });

  it("matches scores by id, not position", () => {
    const scores = [{ id: "D3", fulfilledPct: 0 }, { id: "D1", fulfilledPct: 100 }, { id: "D2", fulfilledPct: 50 }];
    expect(computeBuyerBps(d(5000, 3000, 2000), scores)).toBe(3500);
  });

  it("throws on a missing, duplicate or unknown id", () => {
    expect(() => computeBuyerBps(d(5000, 5000), s(100))).toThrow(/missing score for deliverable D2/);
    expect(() => computeBuyerBps(d(5000, 5000), [...s(100, 0), { id: "D1", fulfilledPct: 10 }])).toThrow(/duplicate/);
    expect(() => computeBuyerBps(d(10000), [...s(100), { id: "D9", fulfilledPct: 10 }])).toThrow(/unknown deliverable D9/);
  });

  it("throws on a non-integer or out-of-range score, and on weights not summing to 10000", () => {
    expect(() => computeBuyerBps(d(5000, 5000), s(50.5, 0))).toThrow(/integer from 0 to 100/);
    expect(() => computeBuyerBps(d(5000, 5000), s(101, 0))).toThrow(/integer from 0 to 100/);
    expect(() => computeBuyerBps(d(5000, 5000), s(-1, 0))).toThrow(/integer from 0 to 100/);
    expect(() => computeBuyerBps(d(5000, 4000), s(0, 0))).toThrow(/sum to 10000, got 9000/);
  });
});

describe("criterion maths (v3)", () => {
  it("met 100, not_met 0, partial floor(100 × s / t)", () => {
    expect(criterionScore({ index: 0, verdict: "met" })).toBe(100);
    expect(criterionScore({ index: 0, verdict: "not_met" })).toBe(0);
    expect(criterionScore({ index: 0, verdict: "partial", satisfied: 12, total: 20 })).toBe(60);
    expect(criterionScore({ index: 0, verdict: "partial", satisfied: 8, total: 12 })).toBe(66); // 66.67 → 66
    expect(criterionScore({ index: 0, verdict: "partial", satisfied: 1, total: 3 })).toBe(33);
    expect(criterionScore({ index: 0, verdict: "partial", satisfied: 2, total: 3 })).toBe(66);
  });

  it("fulfilledPct = floor(mean): scenario A's D2 (12/20, 8/12) → floor((60+66)/2) = 63; D3 (not_met, met) → 50", () => {
    expect(fulfilledFromCriteria([{ index: 0, verdict: "partial", satisfied: 12, total: 20 }, { index: 1, verdict: "partial", satisfied: 8, total: 12 }], 2)).toBe(63);
    expect(fulfilledFromCriteria([{ index: 1, verdict: "met" }, { index: 0, verdict: "not_met" }], 2)).toBe(50);
    expect(fulfilledFromCriteria([{ index: 0, verdict: "met" }, { index: 1, verdict: "met" }, { index: 2, verdict: "not_met" }], 3)).toBe(66); // 200/3 → 66
  });

  it("rejects missing/duplicate/out-of-range indices and malformed verdicts", () => {
    expect(() => fulfilledFromCriteria([{ index: 0, verdict: "met" }], 2)).toThrow(/missing verdict for criterion index 1/);
    expect(() => fulfilledFromCriteria([{ index: 0, verdict: "met" }, { index: 0, verdict: "met" }], 2)).toThrow(/appears more than once/);
    expect(() => fulfilledFromCriteria([{ index: 2, verdict: "met" }], 2)).toThrow(/out of range/);
    expect(() => criterionScore({ index: 0, verdict: "partial" })).toThrow(/needs integer satisfied and total/);
    expect(() => criterionScore({ index: 0, verdict: "partial", satisfied: 5, total: 0 })).toThrow(/total must be >= 1/);
    expect(() => criterionScore({ index: 0, verdict: "partial", satisfied: 21, total: 20 })).toThrow(/between 0 and total/);
    expect(() => criterionScore({ index: 0, verdict: "partial", satisfied: 1.5, total: 3 })).toThrow(/integer/);
    expect(() => criterionScore({ index: 0, verdict: "met", satisfied: 3, total: 4 })).toThrow(/contradictory/);
    expect(() => criterionScore({ index: 0, verdict: "met", satisfied: 4, total: 4 })).not.toThrow();
  });
});

