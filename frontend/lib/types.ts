// API shapes used by the frontend.
// PROVISIONAL: shapes follow docs/API.md on main plus FE additions (phone login, device keys, complaints,
// conflicts, signatures, display names) that the backend still has to agree to.
import type { Address, Hex } from "viem";

// ---- SOW (mirrors shared/src/sow.ts, version "sow/v1") ----
export type Deliverable = {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  weightBps: number; // all deliverables sum to 10000
};

export type Sow = {
  version: "sow/v1";
  title: string;
  buyer: Address;
  seller: Address;
  token: Address;
  amount: string; // base units (6 decimals), integer string
  deliveryDeadline: number; // unix seconds
  reviewWindowSecs: number;
  deliverables: Deliverable[];
};

// ---- Users ----
// Login is phone + OTP (SARAL MPC wallet under the hood). The account is bound to one device: the device
// generates a signing key at login and registers its public address (`deviceKey`). Moving to a new device
// also needs the security PIN, removes the old device, and starts a 24 h cooling period (lower limit).
export type KycLevel = 0 | 1 | 2; // 1 = documents submitted, 2 = approved on-chain (setKyc)
export type Role = "user" | "arbitrator";
export type User = {
  address: Address; // account wallet; never shown to the user
  phone: string;
  name?: string;
  role: Role;
  deviceId: string;
  deviceKey?: Address; // public address of this device's signing key
  kycLevel: KycLevel;
  hasPin: boolean; // security PIN set (asked on app open, new device, signing, releasing money)
  deviceBoundAt?: number; // unix seconds this device was registered
  coolingUntil?: number; // new-device cooling period end; payments capped until then
  wallet?: Address; // linked external crypto wallet, if any
};
export type LoginResult =
  | { status: "ok"; user: User }
  | { status: "pin_required" }; // account is registered on another device
/** What other people see when they look you up by phone or scan your QR. */
export type Contact = {
  phone: string;
  name: string;
  bankingName: string; // legal name from KYC, shown before paying (like GPay)
  address: Address;
  lastActivity?: number;
};

// ---- Drafts (off-chain negotiation, B2) ----
export type Party = "buyer" | "seller";
export type NewDraft = { role: Party; counterpartyPhone: string; purpose: string; price: string; terms: string };
export type DraftStatus = "awaiting_other" | "ready_to_merge" | "merged" | "signed";
export type Draft = {
  id: string;
  initiator: Party; // the payer ("buyer") or the one requesting money ("seller")
  buyer: Address;
  seller: Address;
  buyerName: string;
  sellerName: string;
  purpose: string;
  price: string; // base units
  buyerTerms?: string;
  sellerTerms?: string;
  status: DraftStatus;
  dealId?: string; // set once both have signed
  createdAt: number; // unix seconds
};

/** A point the two sides disagree on. The agreement can't be signed until both propose the same value. */
export type Conflict = {
  field: "deliveryDeadline";
  label: string;
  buyerWants: number; // unix seconds
  sellerWants: number;
  proposals: Partial<Record<Party, number>>;
};
export type Signature = { party: Party; signer: Address; signature: Hex; signedAt: number };
export type SowVersion = {
  draftId: string;
  version: number;
  sow: Sow;
  sowHash: Hex; // keccak256 of the canonical SOW; what each party signs
  conflicts: Conflict[];
  signatures: Signature[];
};

// ---- Deals (on-chain, B1) ----
export type DealStatus =
  | "Proposed"
  | "Accepted"
  | "Funded"
  | "Delivered"
  | "Disputed"
  | "ResolutionProposed"
  | "Escalated"
  | "Released"
  | "Refunded"
  | "Resolved"
  | "Split"
  | "Cancelled";

export type ChainEvent = {
  name: string; // DealProposed, DealFunded, DisputeRaised, Settled, …
  txHash: Hex;
  logIndex: number;
  block: number;
  timestamp: number; // unix seconds
  args: Record<string, string>;
};

export type Deal = {
  id: string; // on-chain id (uint256 as string)
  draftId: string;
  title: string;
  buyer: Address;
  seller: Address;
  buyerName: string;
  sellerName: string;
  amount: string; // base units
  status: DealStatus;
  sowHash: Hex;
  deliverBy: number;
  reviewPeriod: number;
  deliveredAt?: number;
  deliveryNote?: string;
  buyerBps?: number;
  accepted?: Partial<Record<Party, boolean>>; // who accepted the proposed resolution
  ruledBy?: "ai" | "arbitrator";
  arbitratorNote?: string;
  paidWith?: PayMethod;
  events: ChainEvent[];
};

// ---- Payments (PG) ----
export type PayMethod = "upi_qr" | "upi_id" | "upi_app" | "crypto";
export type OnrampSession = { paymentId: string; amountInr: string; amountUsd: string; upiUri: string };

// ---- Complaints / disputes (B1 + B2) ----
export type Attachment = { name: string; type: string; size: number; url?: string };
export type Complaint = {
  dealId: string;
  raisedBy: Party;
  text: string;
  deliverableIds: string[];
  attachments: Attachment[];
  createdAt: number;
};
export type DeliverableScore = { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] };
export type Resolution = { scores: DeliverableScore[]; buyerBps: number };
