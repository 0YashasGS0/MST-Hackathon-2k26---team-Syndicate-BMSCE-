// Merge-plan items 4–7: two-party drafts (FE flow), structured deliveryDeadline conflicts, signed approvals,
// and GET /deals/:id/sow (+ /agreement alias). No network: mock LLM, injected link verifier and chain readers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { privateKeyToAccount } from "viem/accounts";
import { hashSow, parseSow } from "@kernel-exploits/shared";
import { createDisputeRouter, createSowRouter, type SignerAuthorizer } from "../src/sow";
import { SowStore } from "../src/sow/store";
import { MERGE_TOOL, mergeSow } from "../src/agent/mergeSow";
import { geminiToolSchema, STRIPPED_KEYWORDS } from "../src/agent/geminiSchema";
import { openaiToolParameters } from "../src/agent/openaiCompatClient";
import type { LlmClient, ToolCallRequest } from "../src/agent/llm";

// Deterministic throwaway test keys (not secrets): real ECDSA signatures without any network.
const buyerKey = privateKeyToAccount(`0x${"11".repeat(32)}`);
const sellerKey = privateKeyToAccount(`0x${"22".repeat(32)}`);
const deviceKey = privateKeyToAccount(`0x${"33".repeat(32)}`);
const BUYER = buyerKey.address.toLowerCase();
const SELLER = sellerKey.address.toLowerCase();
const DEVICE = deviceKey.address.toLowerCase();
const STRANGER = "0x9999999999999999999999999999999999999999";
const USD = "0x3333333333333333333333333333333333333333";
const T0 = 1_800_000_000;
const DAY = 86400;

const mergeOutput = (days?: unknown) => ({
  title: "Bakery landing page",
  deliverables: [
    { id: "D1", title: "Homepage", description: "Responsive homepage", acceptanceCriteria: ["Works on mobile"], weightBps: 6000 },
    { id: "D2", title: "Menu", description: "Menu page", acceptanceCriteria: ["20 items with prices"], weightBps: 4000 },
  ],
  exclusions: ["Hosting"],
  conflicts: ["Buyer wants 7 days, seller asks for 10 days."],
  ...(days !== undefined && { requestedDeliveryDays: days }),
});

class MockLlm implements LlmClient {
  readonly model = "mock-model";
  calls: ToolCallRequest[] = [];
  constructor(private readonly output: unknown) {}
  async callTool(req: ToolCallRequest) {
    this.calls.push(req);
    return this.output;
  }
}

let clock: number;
function makeApp(opts: { llm?: LlmClient; isAuthorizedSigner?: SignerAuthorizer; store?: SowStore } = {}) {
  const store = opts.store ?? new SowStore(":memory:");
  const llm = opts.llm ?? new MockLlm(mergeOutput());
  const app = express();
  app.use(
    createSowRouter({
      store,
      llm,
      usdAddress: USD,
      demoFallback: false,
      verifyLink: async () => ({ ok: true }),
      isAuthorizedSigner: opts.isAuthorizedSigner,
      now: () => clock,
    }),
  );
  app.use(createDisputeRouter({ store, readDeal: async () => ({ reasoningHash: `0x${"00".repeat(32)}`, proposedBuyerBps: 0, status: 2 }), readSettled: async () => null }));
  return { app, store, llm };
}
const as = (who: string) => ({ "x-user-address": who });

async function sellerDraft(app: express.Express, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/drafts")
    .set(as(SELLER))
    .send({ initiator: "seller", counterparty: BUYER, purpose: "Landing page", price: "100000000", terms: "10 days, hosting excluded", ...extra });
  expect(res.status).toBe(201);
  return res.body;
}

/** Seller creates, buyer adds terms, merge → v1. */
async function merged(app: express.Express) {
  const d = await sellerDraft(app);
  await request(app).post(`/drafts/${d.id}/terms`).set(as(BUYER)).send({ party: "buyer", terms: "Mobile-first, 7 days" }).expect(200);
  const v1 = await request(app).post(`/drafts/${d.id}/merge-sow`).set(as(SELLER)).expect(200);
  return { id: d.id as string, v1: v1.body };
}

const approve = (app: express.Express, id: string, who: string, body: Record<string, unknown>) =>
  request(app).post(`/drafts/${id}/approve-sow`).set(as(who)).send(body);

beforeEach(() => {
  clock = T0;
});
afterEach(() => vi.unstubAllEnvs());

describe("two-party drafts (merge plan 4)", () => {
  it("initiator=seller creates a draft: buyer/seller derived, FE Draft shape, defaults for deadline and review", async () => {
    const { app } = makeApp();
    const d = await sellerDraft(app);
    expect(d).toEqual({
      id: expect.any(String),
      initiator: "seller",
      buyer: BUYER,
      seller: SELLER,
      buyerName: null,
      sellerName: null,
      purpose: "Landing page",
      price: "100000000",
      amount: "100000000",
      sellerTerms: "10 days, hosting excluded",
      sellerPoints: "10 days, hosting excluded",
      deliveryDeadline: T0 + 7 * DAY,
      reviewWindowSecs: 172800,
      status: "awaiting_other",
      stage: "awaiting_other",
      createdAt: T0,
      updatedAt: T0,
    });
    expect(d.buyerTerms).toBeUndefined();
  });

  it("defaults come from DEFAULT_DELIVERY_DAYS / DEFAULT_REVIEW_SECS; explicit values win; amount is accepted too", async () => {
    vi.stubEnv("DEFAULT_DELIVERY_DAYS", "3");
    vi.stubEnv("DEFAULT_REVIEW_SECS", "600");
    const { app } = makeApp();
    const d = await sellerDraft(app);
    expect(d).toMatchObject({ deliveryDeadline: T0 + 3 * DAY, reviewWindowSecs: 600 });
    const e = await request(app)
      .post("/drafts")
      .set(as(BUYER))
      .send({ initiator: "buyer", counterparty: SELLER, purpose: "p", amount: "5", terms: "t", deliveryDeadline: T0 + 99, reviewWindowSecs: 60 })
      .expect(201);
    expect(e.body).toMatchObject({ initiator: "buyer", buyer: BUYER, seller: SELLER, buyerTerms: "t", price: "5", deliveryDeadline: T0 + 99, reviewWindowSecs: 60 });
    vi.stubEnv("DEFAULT_DELIVERY_DAYS", "soon");
    expect(() => makeApp()).toThrow(/DEFAULT_DELIVERY_DAYS/);
  });

  it("rejects bad create bodies: no amount, amount ≠ price, counterparty = caller, past deadline, unknown keys", async () => {
    const { app } = makeApp();
    const base = { initiator: "seller", counterparty: BUYER, purpose: "p", terms: "t" };
    for (const b of [
      base,
      { ...base, amount: "1", price: "2" },
      { ...base, price: "1", counterparty: SELLER },
      { ...base, price: "1", deliveryDeadline: T0 - 1 },
      { ...base, price: "1", buyer: BUYER },
    ]) {
      const res = await request(app).post("/drafts").set(as(SELLER)).send(b);
      expect(res.status, JSON.stringify(b)).toBe(400);
    }
  });

  it("only the side that did NOT create the draft adds terms (403 otherwise); status → ready_to_merge", async () => {
    const { app } = makeApp();
    const d = await sellerDraft(app);
    const seller = await request(app).post(`/drafts/${d.id}/terms`).set(as(SELLER)).send({ party: "seller", terms: "more" });
    expect(seller.status).toBe(403); // the initiator
    expect((await request(app).post(`/drafts/${d.id}/terms`).set(as(SELLER)).send({ party: "buyer", terms: "x" })).status).toBe(403); // as the other party
    expect((await request(app).post(`/drafts/${d.id}/terms`).set(as(STRANGER)).send({ party: "buyer", terms: "x" })).status).toBe(403);
    expect((await request(app).post(`/drafts/${d.id}/seller-input`).set(as(SELLER)).send({ sellerPoints: "x" })).status).toBe(403); // alias, same rule
    const ok = await request(app).post(`/drafts/${d.id}/terms`).set(as(BUYER)).send({ party: "buyer", terms: "Mobile-first" }).expect(200);
    expect(ok.body).toMatchObject({ status: "ready_to_merge", buyerTerms: "Mobile-first", sellerTerms: "10 days, hosting excluded" });
  });

  it("/seller-input stays an alias for buyer-initiated drafts (old body shape)", async () => {
    const { app } = makeApp();
    const c = await request(app)
      .post("/drafts")
      .set(as(BUYER))
      .send({ buyer: BUYER, seller: SELLER, purpose: "p", buyerConstraints: "c", amount: "1", deliveryDeadline: T0 + DAY, reviewWindowSecs: 60 })
      .expect(201);
    expect(c.body).toMatchObject({ initiator: "buyer", status: "awaiting_other", buyerTerms: "c" });
    const s = await request(app).post(`/drafts/${c.body.id}/seller-input`).set(as(SELLER)).send({ sellerPoints: "ok" }).expect(200);
    expect(s.body).toMatchObject({ status: "ready_to_merge", sellerTerms: "ok" });
  });

  it("GET /drafts?address= lists the caller's drafts (buyer or seller), newest first; others' lists are 403", async () => {
    const { app } = makeApp();
    const a = await sellerDraft(app);
    clock = T0 + 10;
    const b = await request(app).post("/drafts").set(as(BUYER)).send({ initiator: "buyer", counterparty: STRANGER, purpose: "p", price: "1", terms: "t" }).expect(201);
    clock = T0 + 20;
    const c = await request(app).post("/drafts").set(as(STRANGER)).send({ initiator: "buyer", counterparty: SELLER, purpose: "p", price: "1", terms: "t" }).expect(201);

    const mine = await request(app).get(`/drafts?address=${BUYER.toUpperCase().replace("0X", "0x")}`).set(as(BUYER)).expect(200);
    expect(mine.body.map((d: { id: string }) => d.id)).toEqual([b.body.id, a.id]);
    const sellers = await request(app).get("/drafts").set(as(SELLER)).expect(200); // address defaults to the caller
    expect(sellers.body.map((d: { id: string }) => d.id)).toEqual([c.body.id, a.id]);
    expect((await request(app).get(`/drafts?address=${SELLER}`).set(as(BUYER))).status).toBe(403);
    expect((await request(app).get(`/drafts?address=nope`).set(as(BUYER))).status).toBe(400);
    expect((await request(app).get(`/drafts?address=${BUYER}`)).status).toBe(401);
  });

  it("status: awaiting_other → ready_to_merge → merged → signed (+ dealId string once linked); GET /drafts/:id/sow", async () => {
    const { app } = makeApp();
    const d = await sellerDraft(app);
    const status = async () => (await request(app).get(`/drafts/${d.id}`).set(as(BUYER)).expect(200)).body;
    expect((await status()).status).toBe("awaiting_other");
    expect((await request(app).get(`/drafts/${d.id}/sow`).set(as(BUYER)).expect(200)).body).toBeNull();
    await request(app).post(`/drafts/${d.id}/terms`).set(as(BUYER)).send({ party: "buyer", terms: "Mobile-first" }).expect(200);
    expect((await status()).status).toBe("ready_to_merge");
    const v1 = (await request(app).post(`/drafts/${d.id}/merge-sow`).set(as(BUYER)).expect(200)).body;
    expect(v1).toMatchObject({ draftId: d.id, version: 1, conflicts: [], signatures: [], sowHash: hashSow(v1.sow) });
    expect((await status()).status).toBe("merged");
    expect((await request(app).get(`/drafts/${d.id}/sow`).set(as(SELLER)).expect(200)).body).toEqual(v1);
    await approve(app, d.id, BUYER, { party: "buyer", version: 1 }).expect(200);
    expect((await status()).status).toBe("merged"); // one side only
    await approve(app, d.id, SELLER, { party: "seller", version: 1 }).expect(200);
    expect((await status()).status).toBe("signed");
    expect((await status()).dealId).toBeUndefined();
    await request(app).post(`/drafts/${d.id}/link`).set(as(BUYER)).send({ dealId: "5", txHash: `0x${"ab".repeat(32)}` }).expect(200);
    expect(await status()).toMatchObject({ status: "signed", stage: "linked", dealId: "5" });
    expect((await request(app).get(`/drafts/${d.id}/sow`).set(as(STRANGER))).status).toBe(403);
  });
});

describe("structured deliveryDeadline conflicts (merge plan 5)", () => {
  it("merge tool: requestedDeliveryDays is optional, and every provider's sanitized schema keeps it without bounds", () => {
    const props = MERGE_TOOL.input_schema.properties as Record<string, { properties: Record<string, unknown> }>;
    expect(Object.keys(props.requestedDeliveryDays.properties)).toEqual(["buyer", "seller"]);
    expect(MERGE_TOOL.input_schema.required).not.toContain("requestedDeliveryDays");
    for (const schema of [geminiToolSchema(MERGE_TOOL), openaiToolParameters(MERGE_TOOL)] as Record<string, unknown>[]) {
      const json = JSON.stringify((schema.properties as Record<string, unknown>).requestedDeliveryDays);
      expect(json).toMatch(/buyer/);
      expect(json).toMatch(/Integer from 1 to 3650 inclusive/);
      for (const k of STRIPPED_KEYWORDS) expect(json).not.toContain(`"${k}"`);
    }
  });

  it("mergeSow returns requestedDeliveryDays + conflictNotes; bad values are dropped with a note, never fatal", async () => {
    const input = { buyer: BUYER, seller: SELLER, purpose: "p", buyerConstraints: "7 days", sellerPoints: "10 days", amount: "1", deliveryDeadline: T0 + DAY, reviewWindowSecs: 60, draftCreatedAt: T0 };
    const ok = await mergeSow(input, { llm: new MockLlm(mergeOutput({ buyer: 7, seller: 10 })), token: USD, demoFallback: false });
    expect(ok).toMatchObject({ requestedDeliveryDays: { buyer: 7, seller: 10 }, conflictNotes: ["Buyer wants 7 days, seller asks for 10 days."], promptVersion: "sow-merge/v2" });
    const llm = new MockLlm(mergeOutput({ buyer: null, seller: 2.5, other: 3 }));
    const bad = await mergeSow(input, { llm, token: USD, demoFallback: false });
    expect(bad.requestedDeliveryDays).toEqual({});
    expect(bad.conflictNotes.filter((n) => n.startsWith("[server]"))).toHaveLength(2);
    expect(llm.calls).toHaveLength(1); // no retry for an advisory field
    expect(llm.calls[0].prompt).toContain(`Draft date (count requestedDeliveryDays from here): ${new Date(T0 * 1000).toISOString()}`);
  });

  it("differing requested days → one Conflict (times from the draft's createdAt); equal days → none", async () => {
    const { app } = makeApp({ llm: new MockLlm(mergeOutput({ buyer: 7, seller: 10 })) });
    clock = T0 + 100; // merge happens later than creation
    const d = await sellerDraft(app);
    await request(app).post(`/drafts/${d.id}/terms`).set(as(BUYER)).send({ party: "buyer", terms: "7 days" }).expect(200);
    clock = T0 + 5000;
    const v1 = (await request(app).post(`/drafts/${d.id}/merge-sow`).set(as(BUYER)).expect(200)).body;
    expect(v1.conflicts).toEqual([
      { field: "deliveryDeadline", label: "Delivery deadline", buyerWants: T0 + 100 + 7 * DAY, sellerWants: T0 + 100 + 10 * DAY, proposals: {} },
    ]);
    expect(v1.conflictNotes).toEqual(["Buyer wants 7 days, seller asks for 10 days."]);

    const same = makeApp({ llm: new MockLlm(mergeOutput({ buyer: 7, seller: 7 })) });
    expect((await merged(same.app)).v1.conflicts).toEqual([]);
    const oneSided = makeApp({ llm: new MockLlm(mergeOutput({ seller: 10 })) });
    expect((await merged(oneSided.app)).v1.conflicts).toEqual([]);
  });

  it("approve-sow is 409 ConflictsOpen while the conflict is open", async () => {
    const { app } = makeApp({ llm: new MockLlm(mergeOutput({ buyer: 7, seller: 10 })) });
    const { id } = await merged(app);
    const res = await approve(app, id, BUYER, { party: "buyer", version: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("ConflictsOpen");
  });

  it("proposals are recorded; when both match, a new version is rebuilt (no LLM) with that deadline and signatures reset", async () => {
    const llm = new MockLlm(mergeOutput({ buyer: 7, seller: 10 }));
    const { app, store } = makeApp({ llm });
    const { id, v1 } = await merged(app);
    const X = T0 + 8 * DAY;
    const Y = T0 + 9 * DAY;

    const p1 = await request(app).post(`/drafts/${id}/conflicts`).set(as(BUYER)).send({ party: "buyer", field: "deliveryDeadline", value: X }).expect(200);
    expect(p1.body).toMatchObject({ version: 1, conflicts: [{ proposals: { buyer: X } }] });
    const p2 = await request(app).post(`/drafts/${id}/conflicts`).set(as(SELLER)).send({ party: "seller", field: "deliveryDeadline", value: Y }).expect(200);
    expect(p2.body).toMatchObject({ version: 1, conflicts: [{ proposals: { buyer: X, seller: Y } }] }); // differ → still open
    expect((await approve(app, id, SELLER, { party: "seller", version: 1 })).body.error.code).toBe("ConflictsOpen");

    const done = await request(app).post(`/drafts/${id}/conflicts`).set(as(SELLER)).send({ party: "seller", field: "deliveryDeadline", value: X }).expect(200);
    expect(done.body).toMatchObject({ version: 2, conflicts: [], signatures: [], approvals: { buyer: false, seller: false } });
    expect(done.body.sow).toEqual({ ...v1.sow, deliveryDeadline: X });
    expect(done.body.sowHash).toBe(hashSow(parseSow(done.body.sow)));
    expect(done.body.sowHash).not.toBe(v1.sowHash);
    expect(done.body.conflictNotes.at(-1)).toMatch(/agreed deliveryDeadline/);
    expect(llm.calls).toHaveLength(1); // only the original merge
    expect(store.getDraft(id)!.deliveryDeadline).toBe(X);
    expect((await request(app).get(`/drafts/${id}/sow`).set(as(BUYER))).body.version).toBe(2);

    // v2 can now be signed by both
    await approve(app, id, BUYER, { party: "buyer", version: 2, signature: await buyerKey.signMessage({ message: { raw: done.body.sowHash } }) }).expect(200);
    const s = await approve(app, id, SELLER, { party: "seller", version: 2, signature: await sellerKey.signMessage({ message: { raw: done.body.sowHash } }) }).expect(200);
    expect(s.body).toMatchObject({ bothApproved: true, proposeDealArgs: { deliverBy: X, sowHash: done.body.sowHash } });
    expect(s.body.signatures).toHaveLength(2);
    // v1 still has no signatures; the rebuilt v2 started with none
    expect(store.getVersion(id, 1)!.signatures).toEqual([]);
  });

  it("proposal errors: wrong party 403, no open conflict 409, past value 400, stranger 403", async () => {
    const { app } = makeApp({ llm: new MockLlm(mergeOutput({ buyer: 7, seller: 10 })) });
    const { id } = await merged(app);
    const post = (who: string, b: Record<string, unknown>) => request(app).post(`/drafts/${id}/conflicts`).set(as(who)).send({ field: "deliveryDeadline", ...b });
    expect((await post(BUYER, { party: "seller", value: T0 + DAY })).status).toBe(403);
    expect((await post(STRANGER, { party: "buyer", value: T0 + DAY })).status).toBe(403);
    expect((await post(BUYER, { party: "buyer", value: T0 - 1 })).status).toBe(400);
    expect((await post(BUYER, { party: "buyer", value: T0 + DAY, field: "amount" })).status).toBe(400);

    const noConflict = makeApp();
    const m = await merged(noConflict.app);
    const res = await request(noConflict.app).post(`/drafts/${m.id}/conflicts`).set(as(BUYER)).send({ party: "buyer", field: "deliveryDeadline", value: T0 + DAY });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NoOpenConflict");
  });
});

describe("approve-sow signatures (merge plan 6)", () => {
  it("signer === caller passes; the response is the SowVersion with all signatures; both → signed + proposeDealArgs", async () => {
    const { app } = makeApp();
    const { id, v1 } = await merged(app);
    const bSig = await buyerKey.signMessage({ message: { raw: v1.sowHash } });
    const b = await approve(app, id, BUYER, { party: "buyer", version: 1, signature: bSig }).expect(200);
    expect(b.body).toMatchObject({ draftId: id, version: 1, sowHash: v1.sowHash, bothApproved: false, conflicts: [] });
    expect(b.body.signatures).toEqual([{ party: "buyer", signer: BUYER, signature: bSig, signedAt: T0 }]);
    expect(b.body.proposeDealArgs).toBeUndefined();

    const sSig = await sellerKey.signMessage({ message: { raw: v1.sowHash } });
    const s = await approve(app, id, SELLER, { party: "seller", version: 1, signature: sSig }).expect(200);
    expect(s.body.signatures).toEqual([
      { party: "buyer", signer: BUYER, signature: bSig, signedAt: T0 },
      { party: "seller", signer: SELLER, signature: sSig, signedAt: T0 },
    ]);
    const sow = parseSow(v1.sow);
    expect(s.body).toMatchObject({
      bothApproved: true,
      proposeDealArgs: { seller: sow.seller, amount: sow.amount, sowHash: hashSow(sow), deliverBy: sow.deliveryDeadline, reviewPeriod: sow.reviewWindowSecs },
    });
    expect((await request(app).get(`/drafts/${id}`).set(as(BUYER))).body.status).toBe("signed");
  });

  it("a foreign signer (device key) is rejected unless isAuthorizedSigner(caller, signer) allows it", async () => {
    const { app } = makeApp();
    const { id, v1 } = await merged(app);
    const devSig = await deviceKey.signMessage({ message: { raw: v1.sowHash } });
    const rejected = await approve(app, id, BUYER, { party: "buyer", version: 1, signature: devSig });
    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe("SignerNotAuthorized");
    // the seller's own wallet signature is foreign to the buyer, too
    const sellerSig = await sellerKey.signMessage({ message: { raw: v1.sowHash } });
    expect((await approve(app, id, BUYER, { party: "buyer", version: 1, signature: sellerSig })).status).toBe(403);
    // a signature over a different hash recovers a different address → rejected
    const wrongMsg = await buyerKey.signMessage({ message: { raw: `0x${"12".repeat(32)}` } });
    expect((await approve(app, id, BUYER, { party: "buyer", version: 1, signature: wrongMsg })).status).toBe(403);

    const seen: [string, string][] = [];
    const registry: SignerAuthorizer = async (caller, signer) => (seen.push([caller, signer]), caller === BUYER && signer === DEVICE);
    const allowed = makeApp({ isAuthorizedSigner: registry });
    const m = await merged(allowed.app);
    const sig = await deviceKey.signMessage({ message: { raw: m.v1.sowHash } });
    const ok = await approve(allowed.app, m.id, BUYER, { party: "buyer", version: 1, signature: sig }).expect(200);
    expect(ok.body.signatures).toEqual([{ party: "buyer", signer: DEVICE, signature: sig, signedAt: T0 }]);
    expect(seen).toEqual([[BUYER, DEVICE]]);
    // the registry does not let the device sign for the seller
    expect((await approve(allowed.app, m.id, SELLER, { party: "seller", version: 1, signature: sig })).status).toBe(403);
  });

  it("malformed signature → 400; pin is accepted and ignored (never stored or echoed)", async () => {
    const { app, store } = makeApp();
    const { id, v1 } = await merged(app);
    expect((await approve(app, id, BUYER, { party: "buyer", version: 1, signature: "0x1234" })).status).toBe(400);
    expect((await approve(app, id, BUYER, { party: "buyer", version: 1, signature: "nothex" })).status).toBe(400);

    const withPin = await approve(app, id, BUYER, { party: "buyer", version: 1, pin: "123456" }).expect(200);
    expect(withPin.body).toMatchObject({ bothApproved: false, signatures: [], approvals: { buyer: true, seller: false } });
    expect(JSON.stringify(withPin.body)).not.toContain("123456");
    const sig = await sellerKey.signMessage({ message: { raw: v1.sowHash } });
    const both = await approve(app, id, SELLER, { party: "seller", version: 1, signature: sig, pin: 4321 }).expect(200);
    expect(both.body.bothApproved).toBe(true);
    const rows = JSON.stringify(store.db.prepare("SELECT * FROM sow_versions").all()) + JSON.stringify(store.db.prepare("SELECT * FROM drafts").all());
    expect(rows).not.toMatch(/123456|4321/);
  });

  it("a PATCH /terms rebuild resets signatures on the new version", async () => {
    const { app } = makeApp();
    const { id, v1 } = await merged(app);
    await approve(app, id, BUYER, { party: "buyer", version: 1, signature: await buyerKey.signMessage({ message: { raw: v1.sowHash } }) }).expect(200);
    const p = await request(app).patch(`/drafts/${id}/terms`).set(as(BUYER)).send({ reviewWindowSecs: 999 }).expect(200);
    expect(p.body.latestSow).toMatchObject({ version: 2, signatures: [], approvals: { buyer: false, seller: false } });
  });
});

describe("GET /deals/:id/sow and /deals/:id/agreement (merge plan 7)", () => {
  async function linked() {
    const ctx = makeApp();
    const { id, v1 } = await merged(ctx.app);
    await approve(ctx.app, id, BUYER, { party: "buyer", version: 1, signature: await buyerKey.signMessage({ message: { raw: v1.sowHash } }) }).expect(200);
    await approve(ctx.app, id, SELLER, { party: "seller", version: 1 }).expect(200);
    await request(ctx.app).post(`/drafts/${id}/link`).set(as(BUYER)).send({ dealId: 42, txHash: `0x${"ab".repeat(32)}` }).expect(200);
    return { ...ctx, id, v1 };
  }

  it("returns the linked SowVersion (with signatures) on both paths, to the parties", async () => {
    const { app, id, v1 } = await linked();
    const sow = await request(app).get("/deals/42/sow").set(as(SELLER)).expect(200);
    expect(sow.body).toMatchObject({ draftId: id, version: 1, sow: v1.sow, sowHash: v1.sowHash, conflicts: [], approvals: { buyer: true, seller: true } });
    expect(sow.body.signatures).toEqual([expect.objectContaining({ party: "buyer", signer: BUYER })]);
    const alias = await request(app).get("/deals/42/agreement").set(as(BUYER)).expect(200);
    expect(alias.body).toEqual(sow.body);
  });

  it("404 for an unlinked/unknown deal, 400 for a bad id, 403 for a stranger, 401 without identity", async () => {
    const { app } = await linked();
    expect((await request(app).get("/deals/43/sow").set(as(BUYER))).status).toBe(404);
    expect((await request(app).get("/deals/abc/agreement").set(as(BUYER))).status).toBe(400);
    expect((await request(app).get("/deals/42/sow").set(as(STRANGER))).status).toBe(403);
    const unauth = await request(app).get("/deals/42/sow");
    expect(unauth.status).toBe(401);
    expect(unauth.body.error.code).toBe("Unauthorized");
  });

  it("uses only the injected getCaller", async () => {
    const { store } = await linked();
    const app = express().use(
      createDisputeRouter({ store, getCaller: () => SELLER, readDeal: async () => ({ reasoningHash: `0x${"00".repeat(32)}`, proposedBuyerBps: 0, status: 2 }), readSettled: async () => null }),
    );
    await request(app).get("/deals/42/sow").set(as(STRANGER)).expect(200);
  });
});
