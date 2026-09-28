// API shapes used by the frontend.
// PROVISIONAL: docs/API.md is not published yet. Shapes follow TEAM_ROADMAP.pdf endpoints and
// B2's draft SOW schema (shared/src/sow.ts on the `yashas` branch). Once `shared/` lands on
// main, import Sow/Deliverable from there instead of redeclaring them.
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
export type KycLevel = 0 | 1 | 2; // 1 = phone/docs submitted, 2 = approved on-chain (setKyc)
export type User = { address: Address; handle?: string; kycLevel: KycLevel; kycTx?: Hex };

// ---- Drafts (off-chain negotiation, B2) ----
export type DraftStatus = "awaiting_seller" | "ready_to_merge" | "merged" | "approved";
export type Draft = {
  id: string;
  buyer: Address;
  seller: Address;
  purpose: string;
  price: string; // base units
  buyerConstraints: string;
  sellerPoints?: string;
  status: DraftStatus;
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
// Status names from TEAM_ROADMAP; exact enum comes from DealEscrow.sol once published.
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
  | "Split";

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

// ---- Disputes (B2) ----
export type DeliverableScore = { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] };
export type Resolution = { scores: DeliverableScore[]; buyerBps: number; reasoningHash: Hex; txHash?: Hex };
export type VerifyResult = {
  reasoning: Record<string, unknown>;
  recomputedBuyerBps: number;
  recomputedHash: Hex;
  onchainReasoningHash: Hex;
  match: boolean;
};
