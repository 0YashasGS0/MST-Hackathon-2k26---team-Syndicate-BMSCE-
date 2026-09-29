import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { hashSow, parseSow } from "@kernel-exploits/shared";
import { createSowRouter } from "../src/sow";
import { SowStore } from "../src/sow/store";
import { getCaller } from "../src/sow/auth";
import { DEAL_PROPOSED, createLinkVerifier, type LinkVerifier, type ReceiptFetcher } from "../src/sow/verifyLink";
import type { LlmClient } from "../src/agent/llm";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x4444444444444444444444444444444444444444";
const USD = "0x3333333333333333333333333333333333333333";
const ESCROW = "0x5555555555555555555555555555555555555555";
const T0 = 1_800_000_000;
const TX = ("0x" + "ab".repeat(32)) as Hex;

const llm: LlmClient = {
  model: "mock",
  callTool: async () => ({
    title: "Bakery site",
    deliverables: [
      { id: "D1", title: "Home", description: "Homepage", acceptanceCriteria: ["mobile ok"], weightBps: 7000 },
      { id: "D2", title: "Menu", description: "Menu", acceptanceCriteria: ["20 items"], weightBps: 3000 },
    ],
    exclusions: [],
    conflicts: [],
  }),
};

let clock = T0;
function makeApp(verifyLink: LinkVerifier = async () => ({ ok: true })) {
  const store = new SowStore(":memory:");
  const app = express();
  app.use(createSowRouter({ store, llm, usdAddress: USD, demoFallback: false, verifyLink, now: () => clock }));
  return app;
}
const as = (who: string) => ({ "x-user-address": who });

async function merged(app: express.Express) {
  const c = await request(app).post("/drafts").set(as(BUYER)).send({
    buyer: BUYER, seller: SELLER, purpose: "Bakery site", buyerConstraints: "mobile", amount: "100000000",
    deliveryDeadline: T0 + 7 * 86400, reviewWindowSecs: 86400,
  });
  const id = c.body.id as string;
  await request(app).post(`/drafts/${id}/seller-input`).set(as(SELLER)).send({ sellerPoints: "no hosting" }).expect(200);
  const m = await request(app).post(`/drafts/${id}/merge-sow`).set(as(BUYER)).expect(200);
  return { id, v1: m.body };
}
async function approvedBoth(app: express.Express) {
  const r = await merged(app);
  await request(app).post(`/drafts/${r.id}/approve-sow`).set(as(BUYER)).send({ party: "buyer", version: 1 }).expect(200);
  await request(app).post(`/drafts/${r.id}/approve-sow`).set(as(SELLER)).send({ party: "seller", version: 1 }).expect(200);
  return r;
}

beforeEach(() => {
  clock = T0;
});

describe("PATCH /drafts/:id/terms", () => {
  it("rebuilds a new version without the LLM, changes the hash and resets approvals", async () => {
    const app = makeApp();
    const { id, v1 } = await approvedBoth(app);
    const res = await request(app).patch(`/drafts/${id}/terms`).set(as(BUYER)).send({ amount: "120000000", deliveryDeadline: T0 + 10 * 86400 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "merged", stage: "sow_proposed" });
    expect(res.body.amount).toBe("120000000");
    const v2 = res.body.latestSow;
    expect(v2.version).toBe(2);
    expect(v2.approvals).toEqual({ buyer: false, seller: false });
    expect(v2.sow.amount).toBe("120000000");
    expect(v2.sow.deliveryDeadline).toBe(T0 + 10 * 86400);
    expect(v2.sow.deliverables).toEqual(v1.sow.deliverables); // LLM content carried over, not re-generated
    expect(v2.sowHash).not.toBe(v1.sowHash);
    expect(v2.sowHash).toBe(hashSow(parseSow(v2.sow)));
    expect(v2.conflictNotes.at(-1)).toMatch(/amount 100000000 → 120000000/);
    // stale approval on v1 is now rejected
    const stale = await request(app).post(`/drafts/${id}/approve-sow`).set(as(SELLER)).send({ party: "seller", version: 1 });
    expect(stale.body.error.code).toBe("StaleVersion");
  });

  it("before any merge, only updates the draft terms", async () => {
    const app = makeApp();
    const c = await request(app).post("/drafts").set(as(BUYER)).send({
      buyer: BUYER, seller: SELLER, purpose: "x", buyerConstraints: "y", amount: "5", deliveryDeadline: T0 + 100, reviewWindowSecs: 60,
    });
    const res = await request(app).patch(`/drafts/${c.body.id}/terms`).set(as(BUYER)).send({ reviewWindowSecs: 120 }).expect(200);
    expect(res.body.reviewWindowSecs).toBe(120);
    expect(res.body.latestSow).toBeNull();
  });

  it("rejects the seller, a linked draft, a past deadline and an empty body", async () => {
    const app = makeApp();
    const { id } = await approvedBoth(app);
    expect((await request(app).patch(`/drafts/${id}/terms`).set(as(SELLER)).send({ amount: "1" })).status).toBe(403);
    expect((await request(app).patch(`/drafts/${id}/terms`).set(as(BUYER)).send({})).status).toBe(400);
    expect((await request(app).patch(`/drafts/${id}/terms`).set(as(BUYER)).send({ deliveryDeadline: T0 - 1 })).status).toBe(400);
    await request(app).post(`/drafts/${id}/link`).set(as(BUYER)).send({ dealId: 3, txHash: TX }).expect(200);
    const linked = await request(app).patch(`/drafts/${id}/terms`).set(as(BUYER)).send({ amount: "1" });
    expect(linked.status).toBe(409);
  });
});

// Build a receipt carrying a real ABI-encoded DealProposed log.
function receipt(o: { to?: string; logAddress?: string; id?: bigint; buyer?: string; seller?: string; amount?: bigint; sowHash: string; status?: "success" | "reverted" }) {
  const topics = encodeEventTopics({
    abi: [DEAL_PROPOSED],
    eventName: "DealProposed",
    args: { id: o.id ?? 3n, buyer: (o.buyer ?? BUYER) as Hex, seller: (o.seller ?? SELLER) as Hex },
  });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "bytes32" }], [o.amount ?? 100000000n, o.sowHash as Hex]);
  return {
    status: o.status ?? "success",
    to: (o.to ?? ESCROW) as Hex,
    logs: [
      {
        address: (o.logAddress ?? o.to ?? ESCROW) as Hex, topics, data,
        blockHash: TX, blockNumber: 1n, logIndex: 0, transactionHash: TX, transactionIndex: 0, removed: false,
      },
    ],
  } as unknown as Awaited<ReturnType<ReceiptFetcher>>;
}

describe("on-chain link verification", () => {
  const expectation = (sowHash: string) => ({ txHash: TX, dealId: 3, buyer: BUYER, seller: SELLER, amount: "100000000", sowHash });
  const verifier = (r: Awaited<ReturnType<ReceiptFetcher>>) => createLinkVerifier({ rpcUrl: "http://unused", escrowAddress: ESCROW, getReceipt: async () => r });
  const H = "0x" + "11".repeat(32);

  it("accepts a correct receipt (addresses compared case-insensitively)", async () => {
    const r = receipt({ sowHash: H, buyer: BUYER.toUpperCase().replace("0X", "0x") });
    expect(await verifier(r)(expectation(H))).toEqual({ ok: true });
  });

  it("rejects a mismatched amount, sowHash, seller, wrong contract, dealId, revert and missing receipt", async () => {
    const cases: [ReturnType<typeof receipt> | null, RegExp][] = [
      [receipt({ sowHash: H, amount: 99n }), /amount 99 does not match SOW amount 100000000/],
      [receipt({ sowHash: "0x" + "22".repeat(32) }), /sowHash .* does not match the approved SOW hash/],
      [receipt({ sowHash: H, seller: OTHER }), /seller .* does not match draft seller/],
      [receipt({ sowHash: H, to: OTHER }), /not the escrow contract/],
      [receipt({ sowHash: H, logAddress: OTHER }), /no DealProposed event from the escrow contract/],
      [receipt({ sowHash: H, id: 4n }), /DealProposed id 4 does not match dealId 3/],
      [receipt({ sowHash: H, status: "reverted" }), /reverted/],
      [null, /receipt not found/],
    ];
    for (const [r, reason] of cases) {
      const res = await verifier(r)(expectation(H));
      expect(res.ok, String(reason)).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(reason);
    }
  });

  it("/link returns 422 with the mismatch and passes the approved SOW hash to the verifier", async () => {
    let seen: Parameters<LinkVerifier>[0] | undefined;
    const app = makeApp(async (e) => {
      seen = e;
      return { ok: false, reason: "on-chain amount 1 does not match SOW amount 100000000" };
    });
    const { id } = await approvedBoth(app);
    const res = await request(app).post(`/drafts/${id}/link`).set(as(BUYER)).send({ dealId: 3, txHash: TX });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: "LinkVerificationFailed", message: expect.stringMatching(/amount 1/) });
    const got = await request(app).get(`/drafts/${id}`).set(as(BUYER)).expect(200);
    expect(got.body).toMatchObject({ status: "signed", stage: "approved" }); // not linked
    expect(seen).toMatchObject({ dealId: 3, buyer: BUYER, seller: SELLER, amount: "100000000", sowHash: got.body.latestSow.sowHash });
  });

  it("/link returns 502 when the chain can't be read", async () => {
    const app = makeApp(async () => {
      throw new Error("fetch failed");
    });
    const { id } = await approvedBoth(app);
    const res = await request(app).post(`/drafts/${id}/link`).set(as(BUYER)).send({ dealId: 3, txHash: TX });
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("ChainUnavailable");
  });
});

describe("getCaller", () => {
  const req = (h?: string) => ({ header: (n: string) => (n === "x-user-address" ? h : undefined) }) as unknown as express.Request;
  it("returns the lowercased address or null", () => {
    expect(getCaller(req(BUYER.toUpperCase().replace("0X", "0x")))).toBe(BUYER);
    expect(getCaller(req())).toBeNull();
    expect(getCaller(req("0x123"))).toBeNull();
  });
});

describe("env fail-fast", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("throws at construction when USD_ADDRESS is missing", () => {
    delete process.env.USD_ADDRESS;
    expect(() => createSowRouter({ store: new SowStore(":memory:"), verifyLink: async () => ({ ok: true }) })).toThrow(
      "createSowRouter: missing required env USD_ADDRESS",
    );
  });

  it("throws when ESCROW_ADDRESS or MST_RPC_URL is missing (no injected verifier)", () => {
    process.env.USD_ADDRESS = USD;
    process.env.MST_RPC_URL = "https://testnetrpc.mstblockchain.com";
    delete process.env.ESCROW_ADDRESS;
    expect(() => createSowRouter({ store: new SowStore(":memory:") })).toThrow("missing required env ESCROW_ADDRESS");
    process.env.ESCROW_ADDRESS = ESCROW;
    delete process.env.MST_RPC_URL;
    expect(() => createSowRouter({ store: new SowStore(":memory:") })).toThrow("missing required env MST_RPC_URL");
    process.env.MST_RPC_URL = "https://testnetrpc.mstblockchain.com";
    expect(() => createSowRouter({ store: new SowStore(":memory:") })).not.toThrow();
  });

  it("rejects a malformed USD_ADDRESS", () => {
    expect(() => createSowRouter({ store: new SowStore(":memory:"), usdAddress: "0x0", verifyLink: async () => ({ ok: true }) })).toThrow(
      "env USD_ADDRESS is invalid",
    );
  });
});
