import { describe, expect, it } from "vitest";
import { computeBuyerBps } from "../src";

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
