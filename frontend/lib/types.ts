// API shapes used by the frontend.
// PROVISIONAL: shapes follow docs/API.md on main plus FE additions (phone login, complaints, display
// names) that the backend still has to agree to. Once `shared/` is imported, take Sow from there.
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

// ---- Users / KYC ----
// Login is phone + OTP (SARAL MPC wallet under the hood). The account is bound to one device, like UPI.
export type KycLevel = 0 | 1 | 2; // 1 = documents submitted, 2 = approved on-chain (setKyc)
export type User = {
  address: Address; // SARAL wallet; never shown to the user
  phone: string;
  name?: string;
  deviceId: string;
  kycLevel: KycLevel;
};

// ---- Drafts (off-chain negotiation, B2) ----
export type DraftStatus = "awaiting_seller" | "ready_to_merge" | "merged" | "approved";
export type Party = "buyer" | "seller";
export type NewDraft = { role: Party; counterparty: string; purpose: string; price: string; terms: string };
export type Draft = {
  id: string;
  initiator: Party; // who started it: the payer ("buyer") or the one requesting money ("seller")
  buyer: Address;
  seller: Address;
  buyerName: string;
  sellerName: string;
  purpose: string;
  price: string; // base units
  buyerConstraints: string;
  sellerPoints?: string;
  status: DraftStatus;
  createdAt: number; // unix seconds
};
export type SowVersion = {
  draftId: string;
  version: number;
  sow: Sow;
  sowHash: Hex;
  buyerApproved: boolean;
  sellerApproved: boolean;
  conflicts: { field: string; buyer: string; seller: string; note?: string }[];
};
export type ApproveSowResult =
  | { bothApproved: false }
  | { bothApproved: true; sowHash: Hex; amount: string; deliverBy: number; reviewPeriod: number };

// ---- Deals (on-chain, B1) ----
// Mirrors DealEscrow.Status on main, plus the legacy settled names the mocks still use.
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
  deliveryHash?: Hex;
  evidenceHash?: Hex;
  buyerBps?: number;
  reasoningHash?: Hex;
  events: ChainEvent[];
};

// ---- Payments (PG) ----
export type OnrampSession = { paymentId: string; amountInr: string; amountUsd: string; upiUri: string };
export type OnrampConfirm = { mintTx: Hex; fundTx: Hex };
export type PaymentInfo = {
  status: "created" | "paid" | "minted" | "funded" | "failed";
  mintTx?: Hex;
  fundTx?: Hex;
  payout?: { toBuyer: string; toSeller: string; finalStatus: DealStatus; txHash: Hex };
};

// ---- Complaints / disputes (B1 + B2) ----
export type Attachment = { name: string; type: string; size: number; url?: string };
export type Complaint = {
  dealId: string;
  text: string;
  deliverableIds: string[];
  attachments: Attachment[];
  createdAt: number;
};
export type DeliverableScore = { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] };
export type Resolution = { scores: DeliverableScore[]; buyerBps: number; reasoningHash: Hex; txHash?: Hex };
export type VerifyResult = {
  reasoning: Record<string, unknown>;
  recomputedBuyerBps: number;
  recomputedHash: Hex;
  onchainReasoningHash: Hex;
  match: boolean;
};
