// Fake backend. Runs on the Next dev server (app/api/mock/route.ts), so every browser and phone that
// opens the app shares the same accounts, deals and complaints. State lives in memory: restarting the
// dev server resets it to the seed data below. Server-only — the browser reaches it through lib/api.ts.
import { getAddress, keccak256, toBytes, verifyMessage, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sowHash, verifySignature } from "./agreement";
import { INR_PER_USD } from "./format";
import type {
  ApiUser,
  Attachment,
  AuthNonce,
  AuthResult,
  ChainEvent,
  Complaint,
  Conflict,
  Contact,
  Deal,
  Draft,
  LoginResult,
  NewDraft,
  OnrampConfirm,
  OnrampSession,
  Party,
  PayMethod,
  Resolution,
  Sow,
  SowVersion,
  User,
} from "./types";

export const DEMO_PIN = "1234"; // security PIN of every seeded account
const COOLING_SECS = 24 * 3600; // new-device cooling period, as UPI apps do
const COOLING_LIMIT_INR = 5000;
const MAX_ATTEMPTS = 5;
const LOCK_SECS = 5 * 60;
const USD = "0x3333333333333333333333333333333333333333" as Address;
const HOUR = 3600;
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const inrToBase = (inr: number) => String(Math.round((inr / INR_PER_USD) * 1e6));
const addressOf = (phone: string) => `0x${phone.padStart(40, "0")}` as Address;
const key = (a: string) => a.toLowerCase();
const NONCE_SECS = 5 * 60;
const SESSION_SECS = 3600;
const SIWE_DOMAIN = "yescro.demo";
// Wallets that sign in as the arbitrator (server-side env, mock only).
const ARBITRATORS = new Set((process.env.MOCK_ARBITRATORS ?? "").split(",").map((a) => key(a.trim())).filter(Boolean));
const fail = (msg: string): never => {
  throw new Error(msg);
};

// ---------------------------------------------------------------- state
type Db = {
  users: Map<string, User>; // by lowercase wallet address
  devices: Map<string, string>; // address → bound deviceId
  drafts: Map<string, Draft>;
  sows: Map<string, SowVersion>; // by draftId
  deals: Deal[];
  complaints: Map<string, Complaint>;
  pins: Map<string, Hex>; // address → hash(address:pin); never stored in plain text
  attempts: Map<string, { count: number; lockedUntil: number }>; // "pin:<address>"
  pendingLogin: Map<string, { deviceId: string; deviceKey: Address; at: number }>; // wallet signed, PIN pending
  nonces: Map<string, { message: string; expiresAt: number }>; // address → issued sign-in message (single use)
  evCounter: number;
};

// Kept on globalThis so dev-server hot reloads don't wipe it.
const g = globalThis as unknown as { __yescroDb?: Promise<Db> };
const db = () => (g.__yescroDb ??= seed());

const userByAddress = (d: Db, a: Address) => d.users.get(key(a));
const userByPhone = (d: Db, phone: string) => [...d.users.values()].find((u) => u.phone && u.phone === phone);

function ev(d: Db, name: string, t: number, args: Record<string, string> = {}): ChainEvent {
  d.evCounter += 1;
  const txHash = `0x${d.evCounter.toString(16).padStart(64, "0")}` as Hex;
  return { name, txHash, logIndex: 0, block: 1_000_000 + d.evCounter * 10, timestamp: t, args };
}

// ---------------------------------------------------------------- agreement drafting ("AI")
function draftSow(title: string, amount: string, buyer: Address, seller: Address, deadline: number, buyerTerms = ""): Sow {
  const criteria = buyerTerms
    .split(/[.\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3 && daysIn(s) === undefined) // timelines live in deliveryDeadline, not criteria
    .slice(0, 3);
  return {
    version: "sow/v1",
    title,
    buyer,
    seller,
    token: USD,
    amount,
    deliveryDeadline: deadline,
    reviewWindowSecs: 2 * DAY,
    deliverables: [
      {
        id: "D1",
        title,
        description: "The main piece of work described in this agreement.",
        acceptanceCriteria: criteria.length ? criteria : ["Matches the description agreed by both sides"],
        weightBps: 6000,
      },
      {
        id: "D2",
        title: "Revisions",
        description: "Changes requested by the payer during review.",
        acceptanceCriteria: ["Up to two rounds of changes are made"],
        weightBps: 2500,
      },
      {
        id: "D3",
        title: "Final handover",
        description: "All final files or access handed over.",
        acceptanceCriteria: ["Everything needed to use the work is shared"],
        weightBps: 1500,
      },
    ],
  };
}

/** "within 5 days" / "needs 10 days" → 5 / 10. */
const daysIn = (text = "") => {
  const m = text.match(/(\d+)\s*(?:working\s*)?days?/i);
  return m ? Number(m[1]) : undefined;
};
const dayStart = (t: number) => t - (t % DAY);

// ---------------------------------------------------------------- seed data
async function seed(): Promise<Db> {
  const d: Db = {
    users: new Map(),
    devices: new Map(),
    drafts: new Map(),
    sows: new Map(),
    deals: [],
    complaints: new Map(),
    pins: new Map(),
    attempts: new Map(),
    pendingLogin: new Map(),
    nonces: new Map(),
    evCounter: 0,
  };
  const keys = new Map<string, Hex>();

  const people: [string, string, User["role"]?][] = [
    ["9000000001", "Priya Sharma"],
    ["9000000002", "Ravi Kumar"],
    ["9000000009", "Arbitrator Desk", "arbitrator"],
    ["9000000003", "Meera Designs"],
    ["9000000004", "Arjun Studio"],
    ["9000000005", "Sneha Arts"],
    ["9000000006", "Ananya Rao"],
    ["9000000007", "Nikhil Sharma"],
    ["9000000008", "SparkleCo"],
    ["9000000010", "Kiran Tech"],
  ];
  for (const [phone, name, role = "user"] of people) {
    const pk = generatePrivateKey();
    keys.set(phone, pk);
    d.users.set(key(addressOf(phone)), {
      address: addressOf(phone),
      phone,
      name,
      role,
      deviceId: "",
      deviceKey: privateKeyToAccount(pk).address,
      kycLevel: role === "arbitrator" ? 2 : 1,
      hasPin: true,
    });
    d.pins.set(key(addressOf(phone)), pinHash(addressOf(phone), DEMO_PIN));
  }

  type S = {
    title: string;
    buyer: string;
    seller: string;
    inr: number;
    status: Deal["status"];
    daysAgo: number;
    settledDaysAgo?: number;
    buyerBps?: number;
    complaint?: Omit<Complaint, "dealId" | "createdAt">;
  };
  const seeds: S[] = [
    { title: "Landing page for bakery", buyer: "9000000001", seller: "9000000002", inr: 8400, status: "Funded", daysAgo: 2 },
    {
      title: "Logo + brand kit", buyer: "9000000001", seller: "9000000002", inr: 4200, status: "ResolutionProposed", daysAgo: 4, buyerBps: AI_BUYER_BPS,
      complaint: {
        raisedBy: "buyer", deliverableIds: ["D2", "D3"],
        text: "Logo files were delivered but the brand guideline PDF is missing and colours don't match what we agreed.",
        attachments: [{ name: "logo-colours.png", type: "image/png", size: 214_000 }, { name: "chat-screenshot.jpg", type: "image/jpeg", size: 98_000 }],
      },
    },
    { title: "Product photos (20 shots)", buyer: "9000000001", seller: "9000000004", inr: 2500, status: "Delivered", daysAgo: 1 },
    {
      title: "Mobile app bug fixes", buyer: "9000000001", seller: "9000000002", inr: 6700, status: "Escalated", daysAgo: 6, buyerBps: AI_BUYER_BPS,
      complaint: {
        raisedBy: "buyer", deliverableIds: ["D1"], text: "Only 2 of the 5 crashes were fixed. The app still crashes on login.",
        attachments: [{ name: "crash-recording.mp4", type: "video/mp4", size: 4_800_000 }],
      },
    },
    { title: "Wedding invitation design", buyer: "9000000001", seller: "9000000005", inr: 1500, status: "Released", daysAgo: 12, settledDaysAgo: 9 },
    { title: "Maths tutoring — 8 sessions", buyer: "9000000006", seller: "9000000001", inr: 3200, status: "Released", daysAgo: 20, settledDaysAgo: 14 },
    {
      title: "Website SEO audit", buyer: "9000000001", seller: "9000000007", inr: 5000, status: "Resolved", daysAgo: 40, settledDaysAgo: 33, buyerBps: AI_BUYER_BPS,
      complaint: {
        raisedBy: "buyer", deliverableIds: ["D3"], text: "The audit report skipped the mobile pages we asked for.",
        attachments: [{ name: "report-page-4.png", type: "image/png", size: 310_000 }],
      },
    },
    { title: "Home cleaning (deep clean)", buyer: "9000000001", seller: "9000000008", inr: 1800, status: "Released", daysAgo: 45, settledDaysAgo: 44 },
    {
      title: "Kitchen cabinet fitting", buyer: "9000000010", seller: "9000000002", inr: 12000, status: "Escalated", daysAgo: 9, buyerBps: AI_BUYER_BPS,
      complaint: {
        raisedBy: "buyer", deliverableIds: ["D1", "D3"], text: "Two cabinet doors are misaligned and the handles were never fitted.",
        attachments: [{ name: "doors.jpg", type: "image/jpeg", size: 1_200_000 }, { name: "walkthrough.mp4", type: "video/mp4", size: 9_400_000 }],
      },
    },
    { title: "Video edit for Instagram reel", buyer: "9000000003", seller: "9000000002", inr: 2200, status: "Released", daysAgo: 15, settledDaysAgo: 12 },
  ];

  for (const [i, s] of seeds.entries()) {
    const id = String(i + 1);
    const t0 = now() - s.daysAgo * DAY;
    const buyer = userByPhone(d, s.buyer)!;
    const seller = userByPhone(d, s.seller)!;
    const amount = inrToBase(s.inr);
    const sow = draftSow(s.title, amount, buyer.address, seller.address, t0 + 5 * DAY);
    const hash = sowHash(sow);
    const sign = async (party: Party, phone: string) => ({
      party,
      signer: privateKeyToAccount(keys.get(phone)!).address,
      signature: await privateKeyToAccount(keys.get(phone)!).signMessage({ message: { raw: hash } }),
      signedAt: t0,
    });
    const draftId = `draft-seed-${id}`;
    d.sows.set(draftId, { draftId, version: 1, sow, sowHash: hash, conflicts: [], signatures: [await sign("buyer", s.buyer), await sign("seller", s.seller)] });

    const reached = (st: Deal["status"][]) => st.includes(s.status);
    const deliveredAt = t0 + Math.max(1, s.daysAgo - 1) * DAY;
    const events = [ev(d, "DealProposed", t0), ev(d, "DealAccepted", t0 + HOUR)];
    if (!reached(["Proposed", "Accepted", "Cancelled"])) events.push(ev(d, "DealFunded", t0 + 2 * HOUR, { amount }));
    if (reached(["Delivered", "Disputed", "ResolutionProposed", "Escalated", "Released", "Resolved"])) events.push(ev(d, "Delivered", deliveredAt));
    if (s.complaint) events.push(ev(d, "DisputeRaised", deliveredAt + 6 * HOUR));
    if (s.buyerBps !== undefined) events.push(ev(d, "ResolutionProposed", deliveredAt + 7 * HOUR, { buyerBps: String(s.buyerBps) }));
    if (s.status === "Escalated") events.push(ev(d, "Escalated", deliveredAt + 10 * HOUR));
    if (s.settledDaysAgo !== undefined) events.push(ev(d, "Settled", now() - s.settledDaysAgo * DAY));

    d.deals.push({
      id,
      draftId,
      title: s.title,
      buyer: buyer.address,
      seller: seller.address,
      buyerName: buyer.name!,
      sellerName: seller.name!,
      amount,
      status: s.status,
      sowHash: hash,
      deliverBy: sow.deliveryDeadline,
      reviewPeriod: 2 * DAY,
      deliveredAt: events.some((e) => e.name === "Delivered") ? deliveredAt : undefined,
      buyerBps: s.buyerBps,
      ruledBy: s.buyerBps !== undefined ? "ai" : undefined,
      accepted: {},
      paidWith: "upi_qr",
      events,
    });
    if (s.complaint) d.complaints.set(id, { ...s.complaint, dealId: id, createdAt: deliveredAt + 6 * HOUR });
  }

  // An agreement in progress where the two sides disagree on the deadline.
  const priya = userByPhone(d, "9000000001")!;
  const ravi = userByPhone(d, "9000000002")!;
  d.drafts.set("draft-demo", {
    id: "draft-demo",
    initiator: "buyer",
    buyer: priya.address,
    seller: ravi.address,
    buyerName: priya.name!,
    sellerName: ravi.name!,
    purpose: "Menu card design",
    price: inrToBase(3000),
    buyerTerms: "Two-page menu card, print ready. Need it within 5 days. Include our logo.",
    sellerTerms: "Can do both pages with two rounds of changes. Needs 8 days. Printing not included.",
    status: "ready_to_merge",
    createdAt: now() - HOUR,
  });
  return d;
}

// ---------------------------------------------------------------- auth / accounts
const pinHash = (address: Address, pin: string) => keccak256(toBytes(`yescro-pin:${key(address)}:${pin}`));

/** Counts wrong attempts per key and locks for LOCK_SECS after MAX_ATTEMPTS, like UPI apps. */
async function guard(k: string, ok: boolean, what: string) {
  const d = await db();
  const a = d.attempts.get(k) ?? { count: 0, lockedUntil: 0 };
  if (a.lockedUntil > now()) fail(`Too many wrong ${what} attempts. Try again in ${Math.ceil((a.lockedUntil - now()) / 60)} min.`);
  if (ok) {
    d.attempts.delete(k);
    return;
  }
  a.count += 1;
  if (a.count >= MAX_ATTEMPTS) {
    d.attempts.set(k, { count: 0, lockedUntil: now() + LOCK_SECS });
    fail(`Too many wrong ${what} attempts. Locked for ${LOCK_SECS / 60} minutes.`);
  }
  d.attempts.set(k, a);
  const left = MAX_ATTEMPTS - a.count;
  fail(`Incorrect ${what}. ${left} attempt${left === 1 ? "" : "s"} left.`);
}

const checkPin = async (d: Db, address: Address, pin: string) =>
  guard(`pin:${key(address)}`, d.pins.get(key(address)) === pinHash(address, pin), "PIN");

function bind(d: Db, address: Address, deviceId: string, deviceKey: Address, newDevice: boolean): User {
  const base = d.users.get(key(address)) ?? fail("Account not found.");
  d.devices.set(key(address), deviceId); // the previous device is de-registered and signs out on its next check
  d.pendingLogin.delete(key(address));
  const u: User = { ...base, deviceId, deviceKey, deviceBoundAt: now(), coolingUntil: newDevice ? now() + COOLING_SECS : undefined };
  d.users.set(key(address), u);
  return u;
}

const apiUser = (u: User): ApiUser => ({ address: u.address, handle: u.name, kycLevel: u.kycLevel });

/** PG's GET /auth/nonce: a single-use sign-in message for this wallet, valid for 5 minutes. */
export async function authNonce(address: string): Promise<AuthNonce> {
  const d = await db();
  let a: Address;
  try {
    a = getAddress(address);
  } catch {
    return fail("A valid wallet address is required.");
  }
  const nonce = keccak256(toBytes(`${a}:${Math.random()}:${Date.now()}`)).slice(2, 34);
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + NONCE_SECS * 1000).toISOString();
  // Same message shape as PG's formatSignInMessage (EIP-4361 style).
  const messageToSign = `${SIWE_DOMAIN} wants you to sign in with your Ethereum account:\n${a}\n\nSign in to MST DealEscrow.\n\nURI: https://${SIWE_DOMAIN}\nVersion: 1\nChain ID: 91562037\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${expirationTime}`;
  d.nonces.set(key(a), { message: messageToSign, expiresAt: now() + NONCE_SECS });
  return { nonce, chainId: 91562037, domain: SIWE_DOMAIN, issuedAt, expirationTime, messageToSign };
}

/** PG's POST /auth/verify: checks the signature over the issued message, consumes the nonce, finds or creates the user. */
export async function authVerify(message: string, signature: Hex): Promise<AuthResult> {
  const d = await db();
  const line = message.split("\n")[1] ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(line)) fail("Sign-in message is invalid.");
  const a = getAddress(line);
  const issued = d.nonces.get(key(a));
  if (!issued || issued.message !== message || issued.expiresAt <= now()) fail("Sign-in expired or already used. Try again.");
  if (!(await verifyMessage({ address: a, message, signature }).catch(() => false))) fail("Wallet signature is invalid.");
  d.nonces.delete(key(a));
  let u = d.users.get(key(a));
  if (!u) {
    const arbitrator = ARBITRATORS.has(key(a));
    u = {
      address: a,
      phone: "",
      name: arbitrator ? "Arbitrator Desk" : undefined,
      role: arbitrator ? "arbitrator" : "user",
      deviceId: "",
      kycLevel: arbitrator ? 2 : 0,
      hasPin: false,
    };
    d.users.set(key(a), u);
  }
  return { user: apiUser(u), expiresIn: SESSION_SECS };
}

export async function logout() {
  return undefined; // the real backend clears its session cookie; the mock keeps no session
}

/** After wallet sign-in. First device or the account's own device → signed in. Registered elsewhere → PIN too. */
export async function bindDevice(user: ApiUser, deviceId: string, deviceKey: Address): Promise<LoginResult> {
  const d = await db();
  const u = d.users.get(key(user.address)) ?? fail("Sign in with your wallet first.");
  const bound = d.devices.get(key(u.address));
  if (u.hasPin && bound && bound !== deviceId) {
    d.pendingLogin.set(key(u.address), { deviceId, deviceKey, at: now() });
    return { status: "pin_required" };
  }
  return { status: "ok", user: bind(d, u.address, deviceId, deviceKey, false) };
}

/** Step 2 on a new device: security PIN. Removes the old device and starts the cooling period. */
export async function verifyNewDevice(address: Address, deviceId: string, pin: string): Promise<User> {
  const d = await db();
  const pending = d.pendingLogin.get(key(address));
  if (!pending || pending.deviceId !== deviceId || now() - pending.at > 300) fail("Session expired. Sign in with your wallet again.");
  await checkPin(d, address, pin);
  return bind(d, address, deviceId, pending!.deviceKey, true);
}

/** The account as the server sees it, so a copy saved on the device can't drift (e.g. after an update). */
export async function getMe(address: Address): Promise<User | null> {
  const d = await db();
  return d.users.get(key(address)) ?? null;
}

export async function checkDevice(address: Address, deviceId: string) {
  const d = await db();
  const bound = d.devices.get(key(address));
  return { valid: !bound || bound === deviceId };
}

export async function setPin(address: Address, deviceId: string, pin: string): Promise<User> {
  const d = await db();
  const u = d.users.get(key(address)) ?? fail("Account not found.");
  if (d.devices.get(key(address)) !== deviceId) fail("This device isn't registered to your account.");
  if (u.hasPin) fail("A security PIN is already set.");
  if (!/^\d{4}$/.test(pin) || /^(\d)\1{3}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin))
    fail("Choose a 4-digit PIN that isn't repeated or sequential digits.");
  d.pins.set(key(address), pinHash(address, pin));
  const next = { ...u, hasPin: true };
  d.users.set(key(address), next);
  return next;
}

/** Confirms the user is present (app unlock, signing, releasing money). */
export async function verifyPin(address: Address, pin: string) {
  const d = await db();
  await checkPin(d, address, pin);
  return { ok: true as const };
}

export async function submitKyc(address: Address, form: { name: string; phone: string; pan: string; fileName: string }): Promise<User> {
  const d = await db();
  const u = d.users.get(key(address)) ?? fail("Account not found.");
  const phone = form.phone.replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) fail("Enter a valid 10-digit mobile number.");
  const taken = userByPhone(d, phone);
  if (taken && key(taken.address) !== key(address)) fail("This mobile number is already registered to another account.");
  const next = { ...u, name: form.name.trim(), phone, kycLevel: 1 as const };
  d.users.set(key(address), next);
  return next;
}

const toContact = (u: User, lastActivity?: number): Contact => ({
  phone: u.phone,
  name: u.name!,
  bankingName: u.name!.toUpperCase(),
  address: u.address,
  lastActivity,
});

export async function lookupContact(phone: string): Promise<Contact | null> {
  const d = await db();
  const u = userByPhone(d, phone.replace(/\D/g, "").slice(-10));
  return u && u.role === "user" && u.name && u.kycLevel > 0 ? toContact(u) : null;
}

/** Everyone you've had a payment or request with, most recent first (GPay "People"). */
export async function listPeople(address: Address): Promise<Contact[]> {
  const d = await db();
  const a = address.toLowerCase();
  const last = new Map<string, number>();
  const touch = (other: Address, t: number) => last.set(other.toLowerCase(), Math.max(last.get(other.toLowerCase()) ?? 0, t));
  for (const x of d.deals) {
    const t = x.events.at(-1)?.timestamp ?? 0;
    if (x.buyer.toLowerCase() === a) touch(x.seller, t);
    else if (x.seller.toLowerCase() === a) touch(x.buyer, t);
  }
  for (const x of d.drafts.values()) {
    if (x.buyer.toLowerCase() === a) touch(x.seller, x.createdAt);
    else if (x.seller.toLowerCase() === a) touch(x.buyer, x.createdAt);
  }
  return [...last]
    .map(([addr, t]) => {
      const u = userByAddress(d, addr as Address);
      return u?.name ? toContact(u, t) : null;
    })
    .filter((c): c is Contact => !!c)
    .sort((x, y) => (y.lastActivity ?? 0) - (x.lastActivity ?? 0));
}

// ---------------------------------------------------------------- negotiation
export async function createDraft(me: Address, n: NewDraft): Promise<Draft> {
  const d = await db();
  const self = d.users.get(key(me)) ?? fail("Account not found.");
  const other = userByPhone(d, n.counterpartyPhone.replace(/\D/g, "").slice(-10));
  if (!other || other.role !== "user" || !other.name) fail("No verified Yescro account with this mobile number.");
  if (key(other!.address) === key(self.address)) fail("You can't create a payment with yourself.");
  const paying = n.role === "buyer";
  const [buyer, seller] = paying ? [self, other!] : [other!, self];
  const draft: Draft = {
    id: `draft-${d.drafts.size + 1}-${Date.now().toString(36)}`,
    initiator: n.role,
    buyer: buyer.address,
    seller: seller.address,
    buyerName: buyer.name!,
    sellerName: seller.name!,
    purpose: n.purpose,
    price: n.price,
    buyerTerms: paying ? n.terms : undefined,
    sellerTerms: paying ? undefined : n.terms,
    status: "awaiting_other",
    createdAt: now(),
  };
  d.drafts.set(draft.id, draft);
  return draft;
}

export async function listDrafts(address: Address): Promise<Draft[]> {
  const d = await db();
  const a = address.toLowerCase();
  return [...d.drafts.values()]
    .filter((x) => x.status !== "signed" && (x.buyer.toLowerCase() === a || x.seller.toLowerCase() === a))
    .sort((x, y) => y.createdAt - x.createdAt);
}

export async function getDraft(draftId: string): Promise<Draft> {
  const d = await db();
  return d.drafts.get(draftId) ?? fail("This payment request was not found.");
}

export async function addTerms(draftId: string, party: Party, terms: string): Promise<Draft> {
  const d = await db();
  const x = await getDraft(draftId);
  const next: Draft = { ...x, [party === "buyer" ? "buyerTerms" : "sellerTerms"]: terms };
  if (next.buyerTerms && next.sellerTerms && next.status === "awaiting_other") next.status = "ready_to_merge";
  d.drafts.set(draftId, next);
  return next;
}

export async function getSow(draftId: string): Promise<SowVersion | null> {
  const d = await db();
  return d.sows.get(draftId) ?? null;
}

/** Drafts the agreement from both sides' terms. Disagreements become conflicts, never a silent middle ground. */
export async function mergeSow(draftId: string): Promise<SowVersion> {
  const d = await db();
  const x = await getDraft(draftId);
  if (!x.buyerTerms || !x.sellerTerms) fail("Both sides need to add their terms first.");
  await new Promise((r) => setTimeout(r, 1200)); // stands in for the LLM call
  const today = dayStart(now());
  const bDays = daysIn(x.buyerTerms);
  const sDays = daysIn(x.sellerTerms);
  const conflicts: Conflict[] = [];
  let deadline = today + (bDays ?? sDays ?? 7) * DAY;
  if (bDays !== undefined && sDays !== undefined && bDays !== sDays) {
    conflicts.push({
      field: "deliveryDeadline",
      label: "Delivery date",
      buyerWants: today + bDays * DAY,
      sellerWants: today + sDays * DAY,
      proposals: {},
    });
    deadline = 0; // unset until both agree
  }
  const sow = draftSow(x.purpose, x.price, x.buyer, x.seller, deadline, x.buyerTerms);
  const prev = d.sows.get(draftId);
  const v: SowVersion = { draftId, version: (prev?.version ?? 0) + 1, sow, sowHash: sowHash(sow), conflicts, signatures: [] };
  d.sows.set(draftId, v);
  d.drafts.set(draftId, { ...x, status: "merged" });
  return v;
}

/** Each side proposes a value for a disputed point; once both propose the same value it goes into the agreement. */
export async function proposeConflict(draftId: string, party: Party, field: Conflict["field"], value: number): Promise<SowVersion> {
  const d = await db();
  const v = d.sows.get(draftId) ?? fail("Prepare the agreement first.");
  const c = v.conflicts.find((x) => x.field === field) ?? fail("That point is already agreed.");
  const proposals = { ...c.proposals, [party]: dayStart(value) };
  const agreed = proposals.buyer !== undefined && proposals.buyer === proposals.seller;
  const conflicts = agreed ? v.conflicts.filter((x) => x.field !== field) : v.conflicts.map((x) => (x.field === field ? { ...x, proposals } : x));
  const sow = agreed ? { ...v.sow, deliveryDeadline: proposals.buyer! } : v.sow;
  const next: SowVersion = { ...v, version: v.version + (agreed ? 1 : 0), sow, sowHash: sowHash(sow), conflicts, signatures: agreed ? [] : v.signatures };
  d.sows.set(draftId, next);
  return next;
}

/** Stores a party's signature after checking it against the agreement and the party's registered device key. */
export async function signSow(draftId: string, party: Party, version: number, signature: Hex, pin: string): Promise<SowVersion> {
  const d = await db();
  const v = d.sows.get(draftId) ?? fail("Prepare the agreement first.");
  const x = await getDraft(draftId);
  await checkPin(d, party === "buyer" ? x.buyer : x.seller, pin);
  if (v.version !== version) fail("The agreement changed. Please review it again.");
  if (v.conflicts.length) fail("Resolve the open points before signing.");
  const signerUser = userByAddress(d, party === "buyer" ? x.buyer : x.seller) ?? fail("Account not found.");
  const sig = { party, signer: signerUser.deviceKey!, signature, signedAt: now() };
  if (!(await verifySignature(v.sow, sig))) fail("Signature check failed. Please sign again on your registered device.");
  const next: SowVersion = { ...v, signatures: [...v.signatures.filter((s) => s.party !== party), sig] };
  d.sows.set(draftId, next);

  // Both signed → the deal goes on-chain (stand-in for proposeDeal + acceptDeal with this sowHash).
  if (next.signatures.length === 2 && !x.dealId) {
    const id = String(Math.max(0, ...d.deals.map((k) => Number(k.id))) + 1);
    const t = now();
    d.deals.unshift({
      id,
      draftId,
      title: x.purpose,
      buyer: x.buyer,
      seller: x.seller,
      buyerName: x.buyerName,
      sellerName: x.sellerName,
      amount: x.price,
      status: "Accepted",
      sowHash: next.sowHash,
      deliverBy: next.sow.deliveryDeadline,
      reviewPeriod: next.sow.reviewWindowSecs,
      accepted: {},
      events: [ev(d, "DealProposed", t, { sowHash: next.sowHash }), ev(d, "DealAccepted", t)],
    });
    d.drafts.set(draftId, { ...x, status: "signed", dealId: id });
  }
  return next;
}

// ---------------------------------------------------------------- deals
export async function listDeals(address: Address): Promise<Deal[]> {
  const d = await db();
  const a = address.toLowerCase();
  return d.deals.filter((x) => x.buyer.toLowerCase() === a || x.seller.toLowerCase() === a);
}
export async function getDeal(id: string): Promise<Deal> {
  const d = await db();
  return d.deals.find((x) => x.id === id) ?? fail("Transaction not found.");
}
export async function getAgreement(dealId: string): Promise<SowVersion | null> {
  const d = await db();
  const deal = await getDeal(dealId);
  return d.sows.get(deal.draftId) ?? null;
}

async function setStatus(id: string, status: Deal["status"], event: string, args: Record<string, string> = {}) {
  const d = await db();
  const deal = await getDeal(id);
  deal.status = status;
  deal.events = [...deal.events, ev(d, event, now(), args)];
  return deal;
}
const expect = (deal: Deal, ok: Deal["status"][]) => ok.includes(deal.status) || fail("This action isn't available any more.");

export async function markDelivered(id: string, note: string): Promise<Deal> {
  const deal = await getDeal(id);
  expect(deal, ["Funded"]);
  deal.deliveredAt = now();
  deal.deliveryNote = note;
  return setStatus(id, "Delivered", "Delivered");
}
export async function release(id: string, pin: string): Promise<Deal> {
  const d = await db();
  const deal = await getDeal(id);
  expect(deal, ["Funded", "Delivered"]);
  await checkPin(d, deal.buyer, pin);
  return setStatus(id, "Released", "Settled");
}

// ---------------------------------------------------------------- payments (PG's on-ramp shapes)
const PAY_METHODS: PayMethod[] = ["upi_qr", "upi_id", "upi_app", "crypto"];
const receipts = new Map<string, OnrampConfirm>(); // dealId → confirmation, so repeat confirms return the same one

export async function onrampSession(id: string): Promise<OnrampSession> {
  const deal = await getDeal(id);
  const inr = ((Number(deal.amount) / 1e6) * INR_PER_USD).toFixed(2);
  const upi = { payee: "yescro.escrow@upi", note: `Yescro escrow deal ${id}` };
  return {
    paymentId: `pay-${id}`,
    amountUsd: deal.amount, // MockUSD base units, like PG
    amountInr: inr,
    status: deal.status === "Accepted" ? "created" : "funded",
    upi,
    upiUri: `upi://pay?pa=${encodeURIComponent(upi.payee)}&pn=${encodeURIComponent("Yescro")}&am=${inr}&cu=INR&tn=${encodeURIComponent(upi.note)}`,
  };
}

/** Mints MockUSD and funds the escrow (stand-in). Idempotent: paying twice funds once. */
export async function onrampConfirm(id: string, method: PayMethod): Promise<OnrampConfirm> {
  if (!PAY_METHODS.includes(method)) fail("Choose how you paid.");
  await new Promise((r) => setTimeout(r, 1200));
  const d = await db();
  const deal = await getDeal(id);
  const done = receipts.get(id);
  if (deal.status !== "Accepted") return done ?? { status: "funded", mintTx: null, fundTx: null };
  const payer = userByAddress(d, deal.buyer);
  const inr = (Number(deal.amount) / 1e6) * INR_PER_USD;
  if (payer?.coolingUntil && payer.coolingUntil > now() && inr > COOLING_LIMIT_INR)
    fail(
      `This device was registered recently. For your safety, payments above ₹${COOLING_LIMIT_INR.toLocaleString("en-IN")} are allowed 24 hours after registering.`,
    );
  deal.paidWith = method;
  const minted = ev(d, "Minted", now(), { amount: deal.amount });
  await setStatus(id, "Funded", "DealFunded", { amount: deal.amount });
  const receipt: OnrampConfirm = { status: "funded", mintTx: minted.txHash, fundTx: deal.events.at(-1)!.txHash };
  receipts.set(id, receipt);
  return receipt;
}

// ---------------------------------------------------------------- complaints / resolution
const scores = [
  { id: "D1", fulfilledPct: 100, rationale: "The main work was delivered as described.", evidenceRefs: ["E1"] },
  { id: "D2", fulfilledPct: 40, rationale: "Only some of the requested changes were made.", evidenceRefs: ["E2"] },
  { id: "D3", fulfilledPct: 0, rationale: "Final files were not handed over.", evidenceRefs: ["E3"] },
];
// buyerBps = Σ weight × (100 − fulfilled) / 100 for weights 6000/2500/1500 → 0 + 1500 + 1500
const AI_BUYER_BPS = 3000;

export async function raiseComplaint(
  id: string,
  party: Party,
  c: { text: string; deliverableIds: string[]; attachments: Attachment[] },
): Promise<Complaint> {
  const d = await db();
  const deal = await getDeal(id);
  expect(deal, ["Funded", "Delivered"]);
  const complaint: Complaint = { ...c, dealId: id, raisedBy: party, createdAt: now() };
  d.complaints.set(id, complaint);
  await setStatus(id, "Disputed", "DisputeRaised");
  // Stand-in for the AI agent reviewing the evidence and proposing a split a few seconds later.
  setTimeout(async () => {
    const x = await getDeal(id);
    if (x.status !== "Disputed") return;
    x.buyerBps = AI_BUYER_BPS;
    x.ruledBy = "ai";
    x.accepted = {};
    await setStatus(id, "ResolutionProposed", "ResolutionProposed", { buyerBps: String(AI_BUYER_BPS) });
  }, 4000);
  return complaint;
}
export async function getComplaint(id: string): Promise<Complaint | null> {
  const d = await db();
  return d.complaints.get(id) ?? null;
}
export async function getResolution(id: string): Promise<Resolution> {
  const deal = await getDeal(id);
  return { scores, buyerBps: deal.buyerBps ?? AI_BUYER_BPS };
}
export async function acceptResolution(id: string, party: Party): Promise<Deal> {
  const deal = await getDeal(id);
  expect(deal, ["ResolutionProposed"]);
  deal.accepted = { ...deal.accepted, [party]: true };
  if (deal.accepted.buyer && deal.accepted.seller) return setStatus(id, "Resolved", "Settled", { buyerBps: String(deal.buyerBps) });
  return deal;
}
export async function escalate(id: string): Promise<Deal> {
  expect(await getDeal(id), ["Disputed", "ResolutionProposed"]);
  return setStatus(id, "Escalated", "Escalated");
}

// ---------------------------------------------------------------- arbitrator
export async function listCases(): Promise<Deal[]> {
  const d = await db();
  return d.deals.filter((x) => x.status === "Escalated" || x.ruledBy === "arbitrator");
}
export async function arbitrate(id: string, buyerBps: number, note: string): Promise<Deal> {
  const deal = await getDeal(id);
  expect(deal, ["Escalated"]);
  if (!(buyerBps >= 0 && buyerBps <= 10000)) fail("Refund must be between 0% and 100%.");
  deal.buyerBps = Math.round(buyerBps);
  deal.ruledBy = "arbitrator";
  deal.arbitratorNote = note;
  await setStatus(id, "Resolved", "Arbitrated", { buyerBps: String(deal.buyerBps) });
  return setStatus(id, "Resolved", "Settled");
}
