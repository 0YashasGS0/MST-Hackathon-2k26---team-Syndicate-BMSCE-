import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { canonicalSow, hashJson, hashSow, parseSow, type Sow } from "../src";

const base: Sow = {
  version: "sow/v1",
  title: "Landing page",
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  token: "0x3333333333333333333333333333333333333333",
  amount: "50000000",
  deliveryDeadline: 1790000000,
  reviewWindowSecs: 86400,
  deliverables: [
    { id: "d1", title: "Design", description: "Figma mock", acceptanceCriteria: ["3 screens"], weightBps: 4000 },
    { id: "d2", title: "Build", description: "Next.js site", acceptanceCriteria: ["deployed", "mobile ok"], weightBps: 6000 },
  ],
  exclusions: ["hosting costs"],
};

describe("hashSow", () => {
  it("is a bytes32 of the canonical JSON", () => {
    const h = hashSow(base);
    expect(h).toMatch(/^0x[0-9a-f]{64}$/);
    expect(h).toBe(keccak256(toBytes(canonicalSow(base))));
  });

  it("ignores key order", () => {
    const reordered = Object.fromEntries(Object.entries(base).reverse());
    expect(hashSow(reordered)).toBe(hashSow(base));
  });

  it("ignores address checksum casing", () => {
    const mixed = { ...base, buyer: "0xAbCdEf0000000000000000000000000000000001" };
    const lower = { ...base, buyer: "0xabcdef0000000000000000000000000000000001" };
    expect(hashSow(mixed)).toBe(hashSow(lower));
  });

  it("changes when any content changes", () => {
    expect(hashSow({ ...base, amount: "50000001" })).not.toBe(hashSow(base));
    const d = structuredClone(base);
    d.deliverables[0].acceptanceCriteria[0] = "4 screens";
    expect(hashSow(d)).not.toBe(hashSow(base));
  });

  it("produces sorted, whitespace-free canonical JSON", () => {
    const json = canonicalSow(base);
    expect(json.startsWith('{"amount":"50000000","buyer":')).toBe(true);
    expect(json).not.toMatch(/\s"|":\s/);
  });
});

describe("hashJson", () => {
  it("is stable under key reordering (including nested objects)", () => {
    const a = { dealId: 7, scores: [{ id: "d1", fulfilledPct: 50 }], meta: { model: "m", promptVersion: "p1" } };
    const b = { meta: { promptVersion: "p1", model: "m" }, scores: [{ fulfilledPct: 50, id: "d1" }], dealId: 7 };
    expect(hashJson(b)).toBe(hashJson(a));
    expect(hashJson(a)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashJson({ ...a, dealId: 8 })).not.toBe(hashJson(a));
  });
});

describe("SowSchema", () => {
  it("rejects amount \"0\"", () => {
    expect(() => parseSow({ ...base, amount: "0" })).toThrow();
  });

  it("requires the exclusions field", () => {
    const { exclusions: _omit, ...noExclusions } = base;
    expect(() => parseSow(noExclusions)).toThrow();
  });

  it("accepts exclusions: []", () => {
    expect(parseSow({ ...base, exclusions: [] }).exclusions).toEqual([]);
  });

  it("rejects weights that do not sum to 10000", () => {
    const bad = structuredClone(base);
    bad.deliverables[1].weightBps = 5999;
    expect(() => parseSow(bad)).toThrow(/sum to 10000/);
  });

  it("rejects duplicate deliverable ids", () => {
    const bad = structuredClone(base);
    bad.deliverables[1].id = "d1";
    expect(() => parseSow(bad)).toThrow(/unique/);
  });

  it("rejects float amounts and unknown keys", () => {
    expect(() => parseSow({ ...base, amount: "50.5" })).toThrow();
    expect(() => parseSow({ ...base, extra: 1 })).toThrow();
  });

  it("rejects buyer == seller", () => {
    expect(() => parseSow({ ...base, seller: base.buyer.toUpperCase().replace("0X", "0x") })).toThrow(/differ/);
  });
});
