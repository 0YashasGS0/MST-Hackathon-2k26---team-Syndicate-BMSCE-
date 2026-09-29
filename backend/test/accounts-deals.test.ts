// The endpoints the frontend calls that didn't exist before: accounts (device binding, PIN, profile, people), the
// unified Deal view, complaints, resolutions, arbitrator access, and device-key signatures on approve-sow.
// Real app stack (createApp); only the chain client is mocked.
import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { privateKeyToAccount } from "viem/accounts";
import { hashSow } from "@kernel-exploits/shared";

const BUYER = "0x1111111111111111111111111111111111111111";
const SELLER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x9999999999999999999999999999999999999999";
const ARB = "0x7777777777777777777777777777777777777777";
const API_KEY = "test-api-key-0123456789";

vi.hoisted(() => {
  const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "acct-db-"));
  Object.assign(process.env, {
    DB_PATH: `${dir}/app.db`,
    BACKEND_API_KEY: "test-api-key-0123456789",
    ADMIN_TOKEN: "test-admin-token-0123456789abcdef",
    ARBITRATOR_ADDRESSES: "0x7777777777777777777777777777777777777777",
    USD_ADDRESS: "0x3333333333333333333333333333333333333333",
    ESCROW_ADDRESS: "0x4444444444444444444444444444444444444444",
    MST_RPC_URL: "https://rpc.invalid",
    AGENT_DEMO_FALLBACK: "true",
    RATE_LIMIT_PER_MIN: "10000",
  });
});

const Z = ("0x" + "0".repeat(64)) as `0x${string}`;
const onchain = (status: number, extra: Record<string, unknown> = {}) => ({
  buyer: BUYER,
  seller: SELLER,
  amount: 100_000_000n,
  sowHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
  deliveryHash: Z,
  evidenceHash: Z,
  reasoningHash: Z,
  deliverBy: 1_900_000_000n,
  reviewPeriod: 172_800n,
  deliveredAt: 0n,
  proposedBuyerBps: 0,
  buyerAccepted: false,
  sellerAccepted: false,
  status,
  ...extra,
});
// Deal 7: Funded. Deal 9: Escalated. Anything else: not found.
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
    readContract: vi.fn(async ({ args }: { args: [bigint] }) => (args[0] === 7n ? onchain(3) : args[0] === 9n ? onchain(7) : onchain(0))),
  },
}));

import { createApp } from "../src/app";
import { db } from "../src/db";
import { sowStore } from "../src/sowStore";
import { accounts } from "../src/accountsStore";

let app: ReturnType<typeof createApp>;
beforeAll(() => {
  app = createApp();
  // The indexer would have seen these deals.
  for (const id of [7, 9]) db.prepare("INSERT OR IGNORE INTO deals (id, buyer, seller, amount, status) VALUES (?, ?, ?, '100000000', 'x')").run(id, BUYER, SELLER);
});

const as = (who: string) => ({ "x-api-key": API_KEY, "x-user-address": who });
const kyc = (who: string, name: string, phone: string) =>
  request(app).post("/kyc/submit").set(as(who)).field("name", name).field("phone", phone).attach("file", Buffer.from("id"), { filename: "id.png", contentType: "image/png" });

describe("accounts: device binding + PIN", () => {
  const devA = privateKeyToAccount(`0x${"a1".repeat(32)}`);
  const devB = privateKeyToAccount(`0x${"b2".repeat(32)}`);

  it("binds the first device, sets a PIN (weak PINs rejected), and moving devices needs the PIN", async () => {
    const first = await request(app).post("/auth/device/bind").set(as(BUYER)).send({ deviceId: "device-aaaa-1", deviceKey: devA.address });
    expect(first.body).toMatchObject({ status: "ok", user: { address: BUYER, deviceId: "device-aaaa-1", deviceKey: devA.address, hasPin: false, role: "user" } });

    for (const pin of ["1111", "1234", "12a4"]) {
      expect((await request(app).post("/auth/pin").set(as(BUYER)).send({ deviceId: "device-aaaa-1", pin })).status).toBe(400);
    }
    expect((await request(app).post("/auth/pin").set(as(BUYER)).send({ deviceId: "device-other", pin: "2580" })).status).toBe(403);
    const set = await request(app).post("/auth/pin").set(as(BUYER)).send({ deviceId: "device-aaaa-1", pin: "2580" });
    expect(set.body).toMatchObject({ hasPin: true });
    expect((await request(app).post("/auth/pin").set(as(BUYER)).send({ deviceId: "device-aaaa-1", pin: "3691" })).status).toBe(409);

    const second = await request(app).post("/auth/device/bind").set(as(BUYER)).send({ deviceId: "device-bbbb-2", deviceKey: devB.address });
    expect(second.body).toEqual({ status: "pin_required" });
    const wrong = await request(app).post("/auth/new-device").set(as(BUYER)).send({ deviceId: "device-bbbb-2", pin: "0000" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error.message).toMatch(/4 attempts left/);
    const moved = await request(app).post("/auth/new-device").set(as(BUYER)).send({ deviceId: "device-bbbb-2", pin: "2580" });
    expect(moved.body).toMatchObject({ deviceId: "device-bbbb-2", deviceKey: devB.address });
    expect(moved.body.coolingUntil).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect((await request(app).post("/auth/device").set(as(BUYER)).send({ deviceId: "device-aaaa-1" })).body).toEqual({ valid: false });
    expect((await request(app).post("/auth/device").set(as(BUYER)).send({ deviceId: "device-bbbb-2" })).body).toEqual({ valid: true });

    // PIN hash is salted scrypt, never the PIN
    const row = db.prepare("SELECT hash FROM pins WHERE address = ?").get(BUYER) as { hash: string };
    expect(row.hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(row.hash).not.toContain("2580");
    expect(accounts.isAuthorizedSigner(BUYER, devB.address)).toBe(true);
    expect(accounts.isAuthorizedSigner(BUYER, devA.address)).toBe(false);
  });

  it("5 wrong PINs lock the account for 5 minutes (even the right PIN is refused)", async () => {
    await request(app).post("/auth/device/bind").set(as(SELLER)).send({ deviceId: "device-seller-1", deviceKey: devA.address });
    await request(app).post("/auth/pin").set(as(SELLER)).send({ deviceId: "device-seller-1", pin: "4826" });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await request(app).post("/auth/pin/verify").set(as(SELLER)).send({ pin: "0000" })).status);
    expect(codes).toEqual([403, 403, 403, 403, 429]);
    const locked = await request(app).post("/auth/pin/verify").set(as(SELLER)).send({ pin: "4826" });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe("PinLocked");
    db.prepare("DELETE FROM pin_attempts").run(); // unlock for later tests
    expect((await request(app).post("/auth/pin/verify").set(as(SELLER)).send({ pin: "4826" })).body).toEqual({ ok: true });
  });

  it("everything needs a signed-in wallet", async () => {
    for (const [m, p] of [["get", "/users/me"], ["post", "/auth/pin/verify"], ["get", "/users/by-phone/9000000001"], ["get", "/people"]] as const) {
      const r = m === "get" ? await request(app).get(p) : await request(app).post(p).send({});
      expect(r.status, p).toBe(401);
    }
  });
});

describe("profile, contacts, people", () => {
  it("KYC saves name + phone; phones are unique; lookup by phone returns a Contact", async () => {
    expect((await kyc(BUYER, "Priya Sharma", "+91 90000 00001")).body).toMatchObject({ name: "Priya Sharma", phone: "9000000001", kycLevel: 1 });
    expect((await kyc(SELLER, "Ravi Kumar", "9000000002")).status).toBe(200);
    const dup = await kyc(STRANGER, "Someone Else", "9000000001");
    expect(dup.status).toBe(409);
    expect((await kyc(STRANGER, "X", "123")).status).toBe(400);
    const found = await request(app).get("/users/by-phone/9000000002").set(as(BUYER));
    expect(found.body).toEqual({ phone: "9000000002", name: "Ravi Kumar", bankingName: "RAVI KUMAR", address: SELLER });
    expect((await request(app).get("/users/by-phone/9876543210").set(as(BUYER))).body).toBeNull();
    const me = await request(app).get("/users/me").set(as(BUYER));
    expect(me.body).toMatchObject({ address: BUYER, name: "Priya Sharma", phone: "9000000001", hasPin: true });
  });

  it("people = counterparts from drafts and deals, own list only", async () => {
    const people = await request(app).get(`/people?address=${BUYER}`).set(as(BUYER));
    expect(people.body.map((c: { address: string }) => c.address)).toEqual([SELLER]);
    expect((await request(app).get(`/people?address=${SELLER}`).set(as(BUYER))).status).toBe(403);
  });
});

describe("deals: one Deal shape, correct status, notes, complaints, resolutions", () => {
  it("GET /deals/:id → FE Deal with the real on-chain status name and display names", async () => {
    const d = await request(app).get("/deals/7").set(as(BUYER));
    expect(d.status).toBe(200);
    expect(d.body).toMatchObject({
      id: "7",
      status: "Funded", // on-chain 3 (was "Disputed" with the old 5-name table)
      buyer: BUYER,
      seller: SELLER,
      buyerName: "Priya Sharma",
      sellerName: "Ravi Kumar",
      amount: "100000000",
      deliverBy: 1_900_000_000,
      reviewPeriod: 172_800,
      events: [],
    });
    expect((await request(app).get("/deals/7").set(as(STRANGER))).status).toBe(403);
    expect((await request(app).get("/deals/8").set(as(BUYER))).status).toBe(404);
    expect((await request(app).get("/deals/7").set(as(ARB))).status).toBe(200); // arbitrator may read
  });

  it("GET /deals?address → Deal[] (a plain array) for the caller only", async () => {
    const list = await request(app).get(`/deals?address=${BUYER}`).set(as(BUYER));
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.map((d: { id: string }) => d.id).sort()).toEqual(["7", "9"]);
    expect((await request(app).get(`/deals?address=${SELLER}`).set(as(BUYER))).status).toBe(403);
  });

  it("a note-only delivery gets a real bytes32 hash, and the note shows on the deal", async () => {
    const r = await request(app).post("/deals/7/delivery").set(as(SELLER)).send({ note: "Site is live at https://example.test" });
    expect(r.body.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.body.hash).not.toBe("0x0");
    expect((await request(app).get("/deals/7").set(as(BUYER))).body.deliveryNote).toBe("Site is live at https://example.test");
  });

  it("evidence stores the complaint; GET /deals/:id/complaint returns it with file metadata", async () => {
    const r = await request(app)
      .post("/deals/7/evidence")
      .set(as(BUYER))
      .field("text", "Menu page missing 8 items")
      .field("deliverables", "D2")
      .field("deliverables", "D3")
      .attach("files", Buffer.from("png"), { filename: "shot.png", contentType: "image/png" });
    expect(r.body.hash).toMatch(/^0x[0-9a-f]{64}$/);
    const c = await request(app).get("/deals/7/complaint").set(as(SELLER));
    expect(c.body).toMatchObject({
      dealId: "7",
      raisedBy: "buyer",
      text: "Menu page missing 8 items",
      deliverableIds: ["D2", "D3"],
      attachments: [{ name: "shot.png", type: "image/png", size: 3 }],
    });
    expect((await request(app).get("/deals/9/complaint").set(as(BUYER))).body).toBeNull();
  });

  it("GET /deals/:id/resolution maps the agent's ruling to { scores, buyerBps }; 404 before one exists", async () => {
    expect((await request(app).get("/deals/7/resolution").set(as(BUYER))).status).toBe(404);
    sowStore.saveRuling({
      dealId: 7,
      sowHash: "0x" + "ab".repeat(32),
      deliveryHash: Z,
      evidenceHash: Z,
      scores: [
        { id: "D1", fulfilledPct: 100, criteria: [{ index: 0, verdict: "met", basis: "admission", rationale: "Buyer confirms.", evidenceRefs: ["E1"] }] },
        { id: "D2", fulfilledPct: 60, criteria: [{ index: 0, verdict: "partial", satisfied: 12, total: 20, basis: "evidence", rationale: "12 of 20.", evidenceRefs: ["E2", "E1"] }] },
      ],
      buyerBps: 1600,
      model: "test",
      promptVersion: "v4",
    });
    const res = await request(app).get("/deals/7/resolution").set(as(SELLER));
    expect(res.body).toEqual({
      buyerBps: 1600,
      scores: [
        { id: "D1", fulfilledPct: 100, rationale: "Buyer confirms.", evidenceRefs: ["E1"] },
        { id: "D2", fulfilledPct: 60, rationale: "12 of 20.", evidenceRefs: ["E2", "E1"] },
      ],
    });
    expect((await request(app).get("/deals/7").set(as(BUYER))).body).toMatchObject({ buyerBps: 1600, ruledBy: "ai" });
  });
});

describe("arbitrator console access", () => {
  it("an arbitrator wallet (ARBITRATOR_ADDRESSES) gets the case list; users get 403; nobody → 401", async () => {
    const cases = await request(app).get("/arbitrator/cases").set(as(ARB));
    expect(cases.status).toBe(200);
    expect(cases.body.map((d: { id: string; status: string }) => [d.id, d.status])).toEqual([["9", "Escalated"]]);
    expect((await request(app).get("/arbitrator/cases").set(as(BUYER))).status).toBe(403);
    expect((await request(app).get("/arbitrator/cases").set("x-api-key", API_KEY)).status).toBe(401);
    expect((await request(app).get("/users/me").set(as(ARB))).body).toMatchObject({ role: "arbitrator", kycLevel: 2 });
  });

  it("ruling: users 403; an arbitrator gets past auth (then needs the arbitrator wallet on the server)", async () => {
    expect((await request(app).post("/arbitrator/deals/9/rule").set(as(BUYER)).send({ buyerBps: 5000, note: "x" })).status).toBe(403);
    const r = await request(app).post("/arbitrator/deals/9/rule").set(as(ARB)).send({ buyerBps: 5000, note: "Half done." });
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe("ChainUnconfigured"); // mocked server has no ARBITRATOR_KEY
  });
});

describe("approve-sow accepts the account's registered device key", () => {
  it("a signature by the bound device key is accepted for its wallet; another device's key is not", async () => {
    const devB = privateKeyToAccount(`0x${"b2".repeat(32)}`); // BUYER's current device (bound above)
    const devA = privateKeyToAccount(`0x${"a1".repeat(32)}`); // BUYER's old device (SELLER's device key too)
    const d = await request(app).post("/drafts").set(as(SELLER)).send({ initiator: "seller", counterparty: BUYER, purpose: "Landing page", price: "5000000", terms: "7 days" });
    expect(d.status).toBe(201);
    await request(app).post(`/drafts/${d.body.id}/terms`).set(as(BUYER)).send({ party: "buyer", terms: "Mobile first" }).expect(200);
    const v = await request(app).post(`/drafts/${d.body.id}/merge-sow`).set(as(BUYER)).expect(200);
    expect(v.body.sowHash).toBe(hashSow(v.body.sow));
    const old = await request(app)
      .post(`/drafts/${d.body.id}/approve-sow`)
      .set(as(BUYER))
      .send({ party: "buyer", version: 1, signature: await devA.signMessage({ message: { raw: v.body.sowHash } }) });
    expect(old.status).toBe(403);
    const ok = await request(app)
      .post(`/drafts/${d.body.id}/approve-sow`)
      .set(as(BUYER))
      .send({ party: "buyer", version: 1, signature: await devB.signMessage({ message: { raw: v.body.sowHash } }), pin: "2580" });
    expect(ok.status).toBe(200);
    expect(ok.body.signatures[0]).toMatchObject({ party: "buyer", signer: devB.address.toLowerCase() });
  });
});
