# API — DRAFT (B1 + B2 finalize and freeze by hour 1)

> Base URL: `NEXT_PUBLIC_API_URL`. JSON everywhere. Errors: `{ "error": { "code": "BadStatus", "message": "..." } }`.
> Amounts: strings in token base units (6 decimals) — `"100000000"` = 100 mUSD. Hashes: `0x`-prefixed 32-byte hex.
> Any change after freeze: update this file in the same commit + note under "Interface changes" in your progress log.

## Auth & KYC
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| POST | `/auth/saral` | PG | `{ address, saralSessionProof }` → `User` |
| POST | `/auth/wallet` | PG | `{ address, signature, message }` → `User` (MetaMask fallback) |
| POST | `/kyc/submit` | B1 | multipart `file` → `User` |
| POST | `/admin/kyc/:address/approve` | B1 | header `x-admin-token` → `{ txHash }` |

## Drafts & SOW
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| POST | `/deals` | B2 | `{ seller, purpose, price, buyerConstraints }` → `Draft` |
| POST | `/deals/:draftId/seller-input` | B2 | `{ sellerPoints }` → `Draft` |
| POST | `/deals/:draftId/merge-sow` | B2 | — → `{ version, sow: SOW, sowHash, conflicts: string[] }` |
| POST | `/deals/:draftId/approve-sow` | B2 | `{ party: "buyer"|"seller", version }` → `{ bothApproved, sowHash?, amount?, deliverBy?, reviewPeriod? }` |
| POST | `/deals/:draftId/link` | B2 | `{ dealId, txHash }` → `Draft` (links draft to on-chain deal id) |

## Deals (on-chain backed)
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| GET | `/deals?address=0x..` | B1 | → `DealSummary[]` |
| GET | `/deals/:id` | B1 | → `Deal` |
| POST | `/deals/:id/delivery` | B1 | multipart `file` → `{ hash }` |
| POST | `/deals/:id/evidence` | B1 | multipart `files[]`, `complaint` → `{ hash }` |
| POST | `/deals/:id/resolve` | B1 (calls B2) | — → `{ scores, buyerBps, reasoningHash, txHash }` |
| POST | `/deals/:id/timeout` | B1 | — → `{ txHash }` |
| GET | `/deals/:id/verify` | B2 | → `{ reasoning, recomputedBps, recomputedHash, onchainHash, match }` |
| POST | `/arbitrator/deals/:id/rule` | B1 | header `x-admin-token`, `{ buyerBps, ruling }` → `{ txHash }` |

## Payments
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| POST | `/onramp/:dealId/session` | PG | — → `{ paymentId, amountInr, amountUsd, status }` |
| POST | `/onramp/:dealId/confirm` | PG | — → `{ status, mintTx, fundTx }` (idempotent) |
| GET | `/deals/:id/payment` | PG | → `{ payment, payout? }` |

## Shapes
```ts
type User = { address: string; handle?: string; kycLevel: 0 | 1 | 2 };

// Authoritative: shared/src/sow.ts (zod, "sow/v1"). Mirrored here for reference.
type SOW = {
  version: "sow/v1";
  title: string;
  buyer: string;            // 0x address
  seller: string;           // 0x address, != buyer
  token: string;            // stablecoin address (MockUSD)
  amount: string;           // base-unit integer string, e.g. "100000000" = 100 mUSD; must equal proposeDeal amount
  deliveryDeadline: number; // unix seconds; must equal proposeDeal deliverBy and be in the future at proposal
  reviewWindowSecs: number; // must equal proposeDeal reviewPeriod
  deliverables: { id: string; title: string; description: string; acceptanceCriteria: string[]; weightBps: number }[]; // Σ = 10000
};

type Draft = { id: string; buyer: string; seller: string; purpose: string; price: string;
  buyerConstraints: string; sellerPoints?: string; status: string; latestSowVersion?: number; dealId?: number };

type ChainEvent = { name: string; args: Record<string, string>; txHash: string; block: number; timestamp: number };

type Deal = {
  id: number; buyer: string; seller: string; amount: string;
  status: "Proposed"|"Accepted"|"Funded"|"Delivered"|"Disputed"|"ResolutionProposed"|"Escalated"|"Released"|"Refunded"|"Resolved"|"Cancelled";
  sowHash: string; deliveryHash: string; evidenceHash: string; reasoningHash: string;
  deliverBy: number; reviewPeriod: number; deliveredAt: number;
  proposedBuyerBps: number; buyerAccepted: boolean; sellerAccepted: boolean;
  sow?: SOW; events: ChainEvent[];
};

type DisputeScores = { scores: { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] }[] }; // integers 0..100
```
