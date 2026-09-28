// In-memory fake backend used by lib/api.ts until each endpoint goes live.
// Lives in the browser tab, so it resets on reload. Hashes are fake placeholders.
import type { Address, Hex } from "viem";
import type {
  ApproveSowResult,
  ChainEvent,
  Complaint,
  Deal,
  Draft,
  NewDraft,
  OnrampConfirm,
  OnrampSession,
  PaymentInfo,
  Resolution,
  Sow,
  SowVersion,
  User,
  VerifyResult,
} from "./types";
import { INR_PER_USD } from "./format";

const ME = "0x1111111111111111111111111111111111111111" as Address;
const OTHER = "0x2222222222222222222222222222222222222222" as Address;
const USD = "0x3333333333333333333333333333333333333333" as Address;
const MY_NAME = "You";

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
const fakeHash = (seed: string): Hex => {
  let h = 0n;
  for (const c of seed) h = (h * 131n + BigInt(c.charCodeAt(0))) % (1n << 256n);
  return `0x${h.toString(16).padStart(64, "0")}` as Hex;
};
const now = () => Math.floor(Date.now() / 1000);
const HOUR = 3600;
const DAY = 86400;
const inrToBase = (inr: number) => String(Math.round((inr / INR_PER_USD) * 1e6));

const drafts = new Map<string, Draft>();
const sowVersions = new Map<string, SowVersion>();
const complaints = new Map<string, Complaint>();
const boundDevice = new Map<string, string>(); // phone → deviceId

const makeSow = (title: string, amount: string, deliverBy: number): Sow => ({
  version: "sow/v1",
  title,
  buyer: ME,
  seller: OTHER,
  token: USD,
  amount,
  deliveryDeadline: deliverBy,
  reviewWindowSecs: 2 * DAY,
  deliverables: [
    {
      id: "D1",
      title: "Responsive landing page",
      description: "Single page with hero, menu and contact sections.",
      acceptanceCriteria: ["Works on mobile and desktop", "Loads in under 2 seconds"],
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
      title: "Go live",
      description: "Published on the buyer's own domain.",
      acceptanceCriteria: ["Site opens securely on the buyer's domain"],
      weightBps: 2000,
    },
  ],
});

let evCounter = 0;
const ev = (name: string, t: number, args: Record<string, string> = {}): ChainEvent => {
  evCounter += 1;
  return { name, txHash: fakeHash(`${name}-${evCounter}`), logIndex: 0, block: 1_000_000 + evCounter * 10, timestamp: t, args };
};

type Seed = {
  id: string;
  title: string;
  counterparty: string;
  inr: number;
  status: Deal["status"];
  startedDaysAgo: number;
  iAmSeller?: boolean;
  settledDaysAgo?: number;
  buyerBps?: number;
};

function seed(s: Seed): Deal {
  const t0 = now() - s.startedDaysAgo * DAY;
  const amount = inrToBase(s.inr);
  const steps: ChainEvent[] = [ev("DealProposed", t0), ev("DealAccepted", t0 + HOUR)];
  const reached = (st: Deal["status"][]) => st.includes(s.status);
  if (!reached(["Proposed", "Accepted", "Cancelled"])) steps.push(ev("DealFunded", t0 + 2 * HOUR, { amount }));
  const deliveredAt = t0 + Math.max(1, s.startedDaysAgo - 1) * DAY;
  if (reached(["Delivered", "Disputed", "ResolutionProposed", "Escalated", "Released", "Resolved"]))
    steps.push(ev("Delivered", deliveredAt));
  if (reached(["Disputed", "ResolutionProposed", "Escalated"])) steps.push(ev("DisputeRaised", deliveredAt + 6 * HOUR));
  if (reached(["ResolutionProposed", "Escalated"]))
    steps.push(ev("ResolutionProposed", deliveredAt + 7 * HOUR, { buyerBps: String(s.buyerBps ?? 0) }));
  if (s.status === "Escalated") steps.push(ev("Escalated", deliveredAt + 10 * HOUR));
  if (s.settledDaysAgo !== undefined) steps.push(ev("Settled", now() - s.settledDaysAgo * DAY));

  return {
    id: s.id,
    draftId: `draft-${s.id}`,
    title: s.title,
    buyer: s.iAmSeller ? OTHER : ME,
    seller: s.iAmSeller ? ME : OTHER,
    buyerName: s.iAmSeller ? s.counterparty : MY_NAME,
    sellerName: s.iAmSeller ? MY_NAME : s.counterparty,
    amount,
    status: s.status,
    sowHash: fakeHash(`sow-${s.id}`),
    deliverBy: t0 + 5 * DAY,
    reviewPeriod: 2 * DAY,
    deliveredAt: steps.some((e) => e.name === "Delivered") ? deliveredAt : undefined,
    buyerBps: s.buyerBps,
    reasoningHash: s.buyerBps !== undefined ? fakeHash(`reasoning-${s.id}`) : undefined,
    events: steps,
  };
}

const deals: Deal[] = [
  seed({ id: "1", title: "Landing page for bakery", counterparty: "Ravi Kumar", inr: 8400, status: "Funded", startedDaysAgo: 2 }),
  seed({ id: "2", title: "Logo + brand kit", counterparty: "Meera Designs", inr: 4200, status: "ResolutionProposed", startedDaysAgo: 4, buyerBps: 3500 }),
  seed({ id: "3", title: "Product photos (20 shots)", counterparty: "Arjun Studio", inr: 2500, status: "Delivered", startedDaysAgo: 1 }),
  seed({ id: "4", title: "Mobile app bug fixes", counterparty: "Kiran Tech", inr: 6700, status: "Escalated", startedDaysAgo: 6, buyerBps: 6000 }),
  seed({ id: "5", title: "Wedding invitation design", counterparty: "Sneha Arts", inr: 1500, status: "Released", startedDaysAgo: 12, settledDaysAgo: 9 }),
  seed({ id: "6", title: "Maths tutoring — 8 sessions", counterparty: "Ananya Rao", inr: 3200, status: "Released", startedDaysAgo: 20, settledDaysAgo: 14, iAmSeller: true }),
  seed({ id: "7", title: "Website SEO audit", counterparty: "Nikhil Sharma", inr: 5000, status: "Resolved", startedDaysAgo: 40, settledDaysAgo: 33, buyerBps: 2000 }),
  seed({ id: "8", title: "Home cleaning (deep clean)", counterparty: "SparkleCo", inr: 1800, status: "Released", startedDaysAgo: 45, settledDaysAgo: 44 }),
];

complaints.set("2", {
  dealId: "2",
  text: "Logo files were delivered but the brand guideline PDF is missing and colours don't match what we agreed.",
  deliverableIds: ["D2", "D3"],
  attachments: [
    { name: "logo-colours.png", type: "image/png", size: 214_000 },
    { name: "chat-screenshot.jpg", type: "image/jpeg", size: 98_000 },
  ],
  createdAt: now() - 3 * DAY,
});
complaints.set("4", {
  dealId: "4",
  text: "Only 2 of the 5 crashes were fixed. App still crashes on login.",
  deliverableIds: ["D1"],
  attachments: [{ name: "crash-recording.mp4", type: "video/mp4", size: 4_800_000 }],
  createdAt: now() - 5 * DAY,
});

complaints.set("7", {
  dealId: "7",
  text: "The audit report skipped the mobile pages we asked for.",
  deliverableIds: ["D3"],
  attachments: [{ name: "report-page-4.png", type: "image/png", size: 310_000 }],
  createdAt: now() - 35 * DAY,
});

drafts.set("draft-demo", {
  id: "draft-demo",
  initiator: "buyer",
  buyer: ME,
  seller: OTHER,
  buyerName: MY_NAME,
  sellerName: "Ravi Kumar",
  purpose: "Landing page for bakery",
  price: inrToBase(8400),
  buyerConstraints: "Must work on mobile. Done within 5 days. Include an order form.",
  sellerPoints: "Needs 10 days. Hosting not included; buyer provides domain.",
  status: "ready_to_merge",
  createdAt: now() - HOUR,
});

// ---- auth / KYC ----
const users = new Map<string, User>();
export async function requestOtp(phone: string): Promise<{ sent: true }> {
  await delay(500);
  void phone;
  return { sent: true };
}
export async function verifyOtp(phone: string, otp: string, deviceId: string): Promise<User> {
  await delay(600);
  if (otp !== "123456") throw new Error("Incorrect OTP. Try again.");
  boundDevice.set(phone, deviceId); // a new device takes over, like UPI re-registration
  const u: User = users.get(phone) ?? { address: ME, phone, deviceId, kycLevel: 0 };
  const next = { ...u, deviceId };
  users.set(phone, next);
  return next;
}
export async function checkDevice(phone: string, deviceId: string): Promise<{ valid: boolean }> {
  await delay(100);
  const bound = boundDevice.get(phone);
  return { valid: !bound || bound === deviceId };
}
export async function submitKyc(form: FormData): Promise<Pick<User, "kycLevel" | "name">> {
  await delay(800);
  return { kycLevel: 1, name: String(form.get("name") ?? "") || undefined };
}

// ---- negotiation / SOW ----
export async function createDraft(d: NewDraft) {
  await delay();
  const paying = d.role === "buyer";
  // Simulated: the other person has already replied with their terms.
  const draft: Draft = {
    id: `draft-${drafts.size + 10}`,
    initiator: d.role,
    buyer: paying ? ME : OTHER,
    seller: paying ? OTHER : ME,
    buyerName: paying ? MY_NAME : d.counterparty,
    sellerName: paying ? d.counterparty : MY_NAME,
    purpose: d.purpose,
    price: d.price,
    buyerConstraints: paying ? d.terms : "Need it within 7 days. Share progress halfway.",
    sellerPoints: paying ? "Can deliver in 7 days. Two rounds of changes included." : d.terms,
    status: "ready_to_merge",
    createdAt: now(),
  };
  drafts.set(draft.id, draft);
  return draft;
}
export async function listDrafts(address: Address): Promise<Draft[]> {
  await delay();
  void address;
  return [...drafts.values()].filter((d) => d.status !== "approved");
}
export async function getSow(draftId: string): Promise<SowVersion | null> {
  await delay();
  return sowVersions.get(draftId) ?? null;
}
export async function getDraft(draftId: string): Promise<Draft> {
  await delay();
  const d = drafts.get(draftId);
  if (!d) throw new Error("This payment request was not found.");
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
  const d = await getDraft(draftId);
  const prev = sowVersions.get(draftId);
  const v: SowVersion = {
    draftId,
    version: (prev?.version ?? 0) + 1,
    sow: makeSow(d.purpose, d.price, now() + 7 * DAY),
    sowHash: fakeHash(`sow-${draftId}`),
    buyerApproved: false,
    sellerApproved: false,
    conflicts: [{ field: "Timeline", buyer: "5 days", seller: "7 days", note: "Agreement uses 7 days" }],
  };
  sowVersions.set(draftId, v);
  drafts.set(draftId, { ...d, status: "merged" });
  return v;
}
export async function approveSow(draftId: string, party: "buyer" | "seller", version: number): Promise<ApproveSowResult> {
  await delay();
  const v = sowVersions.get(draftId);
  if (!v || v.version !== version) throw new Error("The agreement changed. Please review it again.");
  // Simulated: the payee approves at the same time so the demo can continue.
  const next = { ...v, buyerApproved: true, sellerApproved: true };
  void party;
  sowVersions.set(draftId, next);
  return {
    bothApproved: true,
    sowHash: next.sowHash,
    amount: next.sow.amount,
    deliverBy: next.sow.deliveryDeadline,
    reviewPeriod: next.sow.reviewWindowSecs,
  };
}
/** Stand-in for proposeDeal + acceptDeal on-chain; returns the new deal id. */
export async function startDeal(draftId: string): Promise<{ dealId: string }> {
  await delay(800);
  const d = await getDraft(draftId);
  const v = sowVersions.get(draftId);
  const id = String(deals.length + 1);
  const t = now();
  deals.unshift({
    id,
    draftId,
    title: d.purpose,
    buyer: d.buyer,
    seller: d.seller,
    buyerName: d.buyerName,
    sellerName: d.sellerName,
    amount: d.price,
    status: "Accepted",
    sowHash: v?.sowHash ?? fakeHash(`sow-${draftId}`),
    deliverBy: v?.sow.deliveryDeadline ?? t + 7 * DAY,
    reviewPeriod: 2 * DAY,
    events: [ev("DealProposed", t), ev("DealAccepted", t)],
  });
  drafts.set(draftId, { ...d, status: "approved" });
  return { dealId: id };
}

// ---- deals ----
export async function listDeals(address: Address): Promise<Deal[]> {
  await delay();
  void address;
  return [...deals];
}
export async function getDeal(id: string): Promise<Deal> {
  await delay();
  const d = deals.find((x) => x.id === id);
  if (!d) throw new Error("Transaction not found.");
  return d;
}
export async function getDealSow(id: string): Promise<Sow> {
  const d = await getDeal(id);
  return makeSow(d.title, d.amount, d.deliverBy);
}
export async function fileHash(): Promise<{ hash: Hex }> {
  await delay(500);
  return { hash: fakeHash(`file-${Date.now()}`) };
}
function setStatus(id: string, status: Deal["status"], event: string, args: Record<string, string> = {}) {
  const d = deals.find((x) => x.id === id);
  if (!d) throw new Error("Transaction not found.");
  d.status = status;
  d.events = [...d.events, ev(event, now(), args)];
  return d;
}
export async function release(id: string): Promise<Deal> {
  await delay(800);
  setStatus(id, "Released", "Settled");
  return getDeal(id);
}

// ---- payments ----
export async function onrampSession(id: string): Promise<OnrampSession> {
  const d = await getDeal(id);
  const usd = Number(d.amount) / 1e6;
  const inr = (usd * INR_PER_USD).toFixed(2);
  return { paymentId: `pay-${id}`, amountUsd: usd.toFixed(2), amountInr: inr, upiUri: `upi://pay?pa=escrow@mock&am=${inr}&tn=deal-${id}` };
}
export async function onrampConfirm(id: string): Promise<OnrampConfirm> {
  await delay(1500);
  const d = deals.find((x) => x.id === id);
  if (d && d.status === "Accepted") setStatus(id, "Funded", "DealFunded", { amount: d.amount });
  return { mintTx: fakeHash(`mint-${id}`), fundTx: fakeHash(`fund-${id}`) };
}
export async function getPayment(id: string): Promise<PaymentInfo> {
  await delay();
  return { status: "funded", mintTx: fakeHash(`mint-${id}`), fundTx: fakeHash(`fund-${id}`) };
}

// ---- complaints / disputes ----
const demoScores = [
  { id: "D1", fulfilledPct: 100, rationale: "Delivered and works on mobile and desktop.", evidenceRefs: ["E1"] },
  { id: "D2", fulfilledPct: 50, rationale: "The form works, but emails arrive about 10 minutes late.", evidenceRefs: ["E2"] },
  { id: "D3", fulfilledPct: 0, rationale: "Not published on the buyer's domain.", evidenceRefs: ["E3"] },
];
export async function raiseComplaint(id: string, form: FormData): Promise<Complaint> {
  await delay(900);
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const c: Complaint = {
    dealId: id,
    text: String(form.get("text") ?? ""),
    deliverableIds: form.getAll("deliverables").map(String),
    // TODO(storage): upload files and keep their URLs; for now only metadata is kept.
    attachments: files.map((f) => ({ name: f.name, type: f.type, size: f.size })),
    createdAt: now(),
  };
  complaints.set(id, c);
  setStatus(id, "Disputed", "DisputeRaised");
  // Simulated: the AI reviewer answers a few seconds later.
  setTimeout(() => {
    const d = deals.find((x) => x.id === id);
    if (d?.status !== "Disputed") return;
    d.buyerBps = 3500;
    setStatus(id, "ResolutionProposed", "ResolutionProposed", { buyerBps: "3500" });
  }, 4000);
  return c;
}
export async function getComplaint(id: string): Promise<Complaint | null> {
  await delay();
  return complaints.get(id) ?? null;
}
export async function acceptResolution(id: string): Promise<Deal> {
  await delay(800);
  // Simulated: the other party has already accepted, so this settles.
  setStatus(id, "Resolved", "Settled");
  return getDeal(id);
}
export async function escalate(id: string): Promise<Deal> {
  await delay(800);
  setStatus(id, "Escalated", "Escalated");
  return getDeal(id);
}
export async function resolve(id: string): Promise<Resolution> {
  await delay(1500);
  return { scores: demoScores, buyerBps: 3500, reasoningHash: fakeHash(`reasoning-${id}`), txHash: fakeHash(`resolve-${id}`) };
}
export async function getResolution(id: string): Promise<Resolution> {
  await delay();
  const d = await getDeal(id);
  return { scores: demoScores, buyerBps: d.buyerBps ?? 3500, reasoningHash: d.reasoningHash ?? fakeHash(`reasoning-${id}`) };
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
