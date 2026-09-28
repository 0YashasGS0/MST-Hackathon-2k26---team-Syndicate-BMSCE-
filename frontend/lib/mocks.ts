// In-memory fake backend used by lib/api.ts until each endpoint goes live.
// Hashes here are fake placeholders, not real keccak256 of anything.
import type { Address, Hex } from "viem";
import type {
  ApproveSowResult,
  ChainEvent,
  Deal,
  Draft,
  OnrampConfirm,
  OnrampSession,
  PaymentInfo,
  Resolution,
  Sow,
  SowVersion,
  User,
  VerifyResult,
} from "./types";

const BUYER = "0x1111111111111111111111111111111111111111" as Address;
const SELLER = "0x2222222222222222222222222222222222222222" as Address;
const USD = "0x3333333333333333333333333333333333333333" as Address;

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const fakeHash = (seed: string): Hex => {
  let h = 0n;
  for (const c of seed) h = (h * 131n + BigInt(c.charCodeAt(0))) % (1n << 256n);
  return `0x${h.toString(16).padStart(64, "0")}` as Hex;
};
const now = () => Math.floor(Date.now() / 1000);
const HOUR = 3600;
const DAY = 86400;

const users = new Map<string, User>();
const drafts = new Map<string, Draft>();
const sowVersions = new Map<string, SowVersion>();

const demoSow: Sow = {
  version: "sow/v1",
  title: "Landing page for bakery",
  buyer: BUYER,
  seller: SELLER,
  token: USD,
  amount: "100000000", // 100 mUSD
  deliveryDeadline: now() + 5 * DAY,
  reviewWindowSecs: 2 * DAY,
  deliverables: [
    {
      id: "D1",
      title: "Responsive landing page",
      description: "Single page with hero, menu and contact sections.",
      acceptanceCriteria: ["Renders on mobile and desktop", "Lighthouse performance ≥ 90"],
      weightBps: 5000,
    },
    {
      id: "D2",
      title: "Online order form",
      description: "Form that emails orders to the owner.",
      acceptanceCriteria: ["Order email arrives within 1 minute"],
      weightBps: 3000,
    },
    {
      id: "D3",
      title: "Deployment",
      description: "Deployed on the buyer's domain.",
      acceptanceCriteria: ["Site reachable over HTTPS on buyer's domain"],
      weightBps: 2000,
    },
  ],
};

const ev = (name: string, i: number, t: number, args: Record<string, string>): ChainEvent => ({
  name,
  txHash: fakeHash(`${name}-${i}`),
  logIndex: 0,
  block: 1_000_000 + i * 10,
  timestamp: t,
  args,
});

const t0 = now() - 3 * DAY;
const deals: Deal[] = [
  {
    id: "1",
    draftId: "draft-1",
    title: demoSow.title,
    buyer: BUYER,
    seller: SELLER,
    amount: demoSow.amount,
    status: "Funded",
    sowHash: fakeHash("sow-1"),
    deliverBy: demoSow.deliveryDeadline,
    reviewPeriod: demoSow.reviewWindowSecs,
    events: [
      ev("DealProposed", 1, t0, { buyer: BUYER, seller: SELLER, amount: demoSow.amount }),
      ev("DealAccepted", 2, t0 + HOUR, { seller: SELLER }),
      ev("DealFunded", 3, t0 + 2 * HOUR, { amount: demoSow.amount }),
    ],
  },
  {
    id: "2",
    draftId: "draft-2",
    title: "Logo + brand kit",
    buyer: BUYER,
    seller: SELLER,
    amount: "50000000",
    status: "ResolutionProposed",
    sowHash: fakeHash("sow-2"),
    deliverBy: now() - DAY,
    reviewPeriod: 2 * DAY,
    deliveredAt: now() - DAY,
    deliveryHash: fakeHash("delivery-2"),
    evidenceHash: fakeHash("evidence-2"),
    buyerBps: 3500,
    reasoningHash: fakeHash("reasoning-2"),
    events: [
      ev("DealProposed", 4, t0, { amount: "50000000" }),
      ev("DealAccepted", 5, t0 + HOUR, {}),
      ev("DealFunded", 6, t0 + 2 * HOUR, { amount: "50000000" }),
      ev("Delivered", 7, now() - DAY, { deliveryHash: fakeHash("delivery-2") }),
      ev("DisputeRaised", 8, now() - 12 * HOUR, { evidenceHash: fakeHash("evidence-2") }),
      ev("ResolutionProposed", 9, now() - 11 * HOUR, { buyerBps: "3500" }),
    ],
  },
];

// ---- auth / KYC ----
export async function login(address: Address): Promise<User> {
  await delay();
  const u = users.get(address) ?? { address, kycLevel: 0 as const };
  users.set(address, u);
  return u;
}
export async function getUser(address: Address): Promise<User> {
  await delay();
  return users.get(address) ?? { address, kycLevel: 0 };
}
export async function submitKyc(form: FormData): Promise<User> {
  await delay(600);
  const address = String(form.get("address")) as Address;
  const u: User = { address, kycLevel: 1 };
  users.set(address, u);
  return u;
}

// ---- negotiation / SOW ----
export async function createDraft(d: { seller: string; purpose: string; price: string; buyerConstraints: string }) {
  await delay();
  const draft: Draft = {
    id: `draft-${drafts.size + 10}`,
    buyer: BUYER,
    seller: d.seller as Address,
    purpose: d.purpose,
    price: d.price,
    buyerConstraints: d.buyerConstraints,
    status: "awaiting_seller",
  };
  drafts.set(draft.id, draft);
  return draft;
}
export async function getDraft(draftId: string): Promise<Draft> {
  await delay();
  const d = drafts.get(draftId);
  if (!d) throw new Error(`draft ${draftId} not found`);
  return d;
}
export async function sellerInput(draftId: string, sellerPoints: string): Promise<Draft> {
  const d = await getDraft(draftId);
  const next: Draft = { ...d, sellerPoints, status: "ready_to_merge" };
  drafts.set(draftId, next);
  return next;
}
export async function mergeSow(draftId: string): Promise<SowVersion> {
  await delay(1200); // LLM call
  const prev = sowVersions.get(draftId);
  const v: SowVersion = {
    draftId,
    version: (prev?.version ?? 0) + 1,
    sow: demoSow,
    sowHash: fakeHash(`sow-${draftId}`),
    buyerApproved: false,
    sellerApproved: false,
    conflicts: [{ field: "deliveryDeadline", buyer: "5 days", seller: "10 days", note: "Parties disagree on timeline" }],
  };
  sowVersions.set(draftId, v);
  const d = drafts.get(draftId);
  if (d) drafts.set(draftId, { ...d, status: "merged" });
  return v;
}
export async function approveSow(draftId: string, party: "buyer" | "seller", version: number): Promise<ApproveSowResult> {
  await delay();
  const v = sowVersions.get(draftId);
  if (!v || v.version !== version) throw new Error("stale SOW version");
  const next = { ...v, [party === "buyer" ? "buyerApproved" : "sellerApproved"]: true };
  sowVersions.set(draftId, next);
  if (!(next.buyerApproved && next.sellerApproved)) return { bothApproved: false };
  return {
    bothApproved: true,
    sowHash: next.sowHash,
    amount: next.sow.amount,
    deliverBy: next.sow.deliveryDeadline,
    reviewPeriod: next.sow.reviewWindowSecs,
  };
}

// ---- deals ----
export async function listDeals(address: Address): Promise<Deal[]> {
  await delay();
  const a = address.toLowerCase();
  const mine = deals.filter((d) => d.buyer.toLowerCase() === a || d.seller.toLowerCase() === a);
  return mine.length ? mine : deals; // show demo deals to any wallet while mocked
}
export async function getDeal(id: string): Promise<Deal> {
  await delay();
  const d = deals.find((x) => x.id === id);
  if (!d) throw new Error(`deal ${id} not found`);
  return d;
}
export async function fileHash(): Promise<{ hash: Hex }> {
  await delay(500);
  return { hash: fakeHash(`file-${Date.now()}`) };
}

// ---- payments ----
const INR_PER_USD = 84;
export async function onrampSession(id: string): Promise<OnrampSession> {
  const d = await getDeal(id);
  const usd = Number(d.amount) / 1e6;
  return {
    paymentId: `pay-${id}`,
    amountUsd: usd.toFixed(2),
    amountInr: (usd * INR_PER_USD).toFixed(2),
    upiUri: `upi://pay?pa=escrow@mock&am=${(usd * INR_PER_USD).toFixed(2)}&tn=deal-${id}`,
  };
}
export async function onrampConfirm(id: string): Promise<OnrampConfirm> {
  await delay(1500);
  return { mintTx: fakeHash(`mint-${id}`), fundTx: fakeHash(`fund-${id}`) };
}
export async function getPayment(id: string): Promise<PaymentInfo> {
  await delay();
  return { status: "funded", mintTx: fakeHash(`mint-${id}`), fundTx: fakeHash(`fund-${id}`) };
}

// ---- disputes ----
const demoScores = [
  { id: "D1", fulfilledPct: 100, rationale: "Page delivered and responsive.", evidenceRefs: ["E1"] },
  { id: "D2", fulfilledPct: 50, rationale: "Form submits but emails arrive after ~10 minutes.", evidenceRefs: ["E2"] },
  { id: "D3", fulfilledPct: 0, rationale: "Not deployed to buyer's domain.", evidenceRefs: ["E3"] },
];
export async function resolve(id: string): Promise<Resolution> {
  await delay(1500);
  return { scores: demoScores, buyerBps: 3500, reasoningHash: fakeHash(`reasoning-${id}`), txHash: fakeHash(`resolve-${id}`) };
}
export async function verify(id: string): Promise<VerifyResult> {
  await delay();
  const h = fakeHash(`reasoning-${id}`);
  return {
    reasoning: { dealId: id, scores: demoScores, buyerBps: 3500, model: "mock", promptVersion: "mock-v0" },
    recomputedBuyerBps: 3500,
    recomputedHash: h,
    onchainReasoningHash: h,
    match: true,
  };
}
export async function arbitrate(id: string, buyerBps: number): Promise<{ txHash: Hex }> {
  await delay(800);
  return { txHash: fakeHash(`arbitrate-${id}-${buyerBps}`) };
}
