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
> B2's router, mounted by B1 (`app.use(createSowRouter())`). Paths are `/drafts/*` so they never clash with B1's on-chain `/deals/:id`.
> Caller identity: the `getCaller` injected into `createSowRouter` / `createDisputeRouter` (B1 passes PG's `getCaller` from `backend/src/auth.ts`: session cookie; the `x-user-address: 0x…` header **only** when `AUTH_DEV_HEADER=true`). B2's default `getCaller` (`backend/src/sow/auth.ts`) has no sessions: header iff `AUTH_DEV_HEADER=true`, else nobody is signed in. No identity → **401** `{ "error": { "code": "Unauthorized", "message" } }`; signed in but not a party → 403 `Forbidden`.

| Method | Path | Owner | Body → Response |
|---|---|---|---|
| POST | `/drafts` | B2 | `{ buyer, seller, purpose, buyerConstraints, amount, deliveryDeadline, reviewWindowSecs }` → `Draft` (201). Caller must be `buyer`. `amount` base-unit string > 0; `deliveryDeadline` unix s, future |
| GET | `/drafts/:id` | B2 | → `Draft & { latestSow: SowVersion \| null }` (parties only) |
| PATCH | `/drafts/:id/terms` | B2 | any of `{ amount, deliveryDeadline, reviewWindowSecs }` → `Draft & { latestSow }`. Buyer only; 409 once linked. If a SOW exists, a new version is rebuilt from it with the new terms (no LLM call), re-hashed, and both approvals reset |
| POST | `/drafts/:id/seller-input` | B2 | `{ sellerPoints }` → `Draft` (seller only; status → `ready_to_merge`) |
| POST | `/drafts/:id/merge-sow` | B2 | — → `{ version, sow: SOW, sowHash, conflicts: string[] }`. New version, approvals reset. 422 `SowValidationFailed` if the agent can't produce a valid SOW after 1 retry; 502 `LlmUnavailable` |
| POST | `/drafts/:id/approve-sow` | B2 | `{ party: "buyer"\|"seller", version }` → `{ bothApproved, version, sowHash, proposeDealArgs? }`. `version` must be the latest (409 `StaleVersion`); 409 `DeadlinePassed` / `TokenMismatch` block the final approval |
| POST | `/drafts/:id/link` | B2 | `{ dealId, txHash }` → `Draft` (buyer only, after both approved; status → `linked`). Reads the receipt from MST: it must succeed, be sent to `ESCROW_ADDRESS`, and emit `DealProposed` with matching id, buyer, seller, amount and the approved `sowHash`. Otherwise 422 `LinkVerificationFailed` with the specific mismatch; 502 `ChainUnavailable` if the RPC fails |

## Deals (on-chain backed)
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| GET | `/deals?address=0x..` | B1 | → `DealSummary[]` |
| GET | `/deals/:id` | B1 | → `Deal` |
| POST | `/deals/:id/delivery` | B1 | multipart `file` → `{ hash }` |
| POST | `/deals/:id/evidence` | B1 | multipart `files[]`, `complaint` → `{ hash }` |
| POST | `/deals/:id/resolve` | B1 (calls B2) | — → `{ scores, buyerBps, reasoningHash, txHash }` |
| POST | `/deals/:id/timeout` | B1 | — → `{ txHash }` |
| GET | `/deals/:id/verify` | B2 | → `VerifyResponse` (below). Reads `getDeal(id)` on MST. 404 `NoRuling` when there's no `reasoningHash` on-chain yet; 404 `NotFound` for an unknown deal; 400 for a bad id; 502 `ChainUnavailable`. Mounted via `createDisputeRouter()` |
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
  amount: string;           // base-unit integer string, must be > 0 (proposeDeal reverts on 0), e.g. "100000000" = 100 mUSD; must equal proposeDeal amount
  deliveryDeadline: number; // unix seconds; must equal proposeDeal deliverBy and be in the future at proposal
  reviewWindowSecs: number; // must equal proposeDeal reviewPeriod
  deliverables: { id: string; title: string; description: string; acceptanceCriteria: string[]; weightBps: number }[]; // Σ = 10000
  exclusions: string[];     // required, out-of-scope items (max 20, each 1–500 chars); [] allowed
};

type DraftStatus = "awaiting_seller" | "ready_to_merge" | "sow_proposed" | "approved" | "linked";
type Draft = { id: string; buyer: string; seller: string; purpose: string; buyerConstraints: string;
  amount: string; deliveryDeadline: number; reviewWindowSecs: number; sellerPoints?: string;
  status: DraftStatus; latestSowVersion?: number; dealId?: number; linkTxHash?: string; createdAt: number; updatedAt: number };

type SowVersion = { version: number; sow: SOW; sowHash: string; conflicts: string[]; approvals: { buyer: boolean; seller: boolean } };

// Exactly the args for DealEscrow.proposeDeal, derived only from the stored SOW (never differs from what was hashed).
type ProposeDealArgs = { seller: string; amount: string; sowHash: string; deliverBy: number; reviewPeriod: number };

type ChainEvent = { name: string; args: Record<string, string>; txHash: string; block: number; timestamp: number };

type Deal = {
  id: number; buyer: string; seller: string; amount: string;
  status: "Proposed"|"Accepted"|"Funded"|"Delivered"|"Disputed"|"ResolutionProposed"|"Escalated"|"Released"|"Refunded"|"Resolved"|"Cancelled";
  sowHash: string; deliveryHash: string; evidenceHash: string; reasoningHash: string;
  deliverBy: number; reviewPeriod: number; deliveredAt: number;
  proposedBuyerBps: number; buyerAccepted: boolean; sellerAccepted: boolean;
  sow?: SOW; events: ChainEvent[];
};

type DisputeScores = { scores: { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] }[] }; // v1/v2; integers 0..100

// v3 (AGENT_PROMPT_VERSION=v3): the LLM outputs verdicts only; fulfilledPct is computed by code.
//   criterion score: met 100 | not_met 0 | partial floor(100 × satisfied / total)   (shared/src/split.ts criterionScore)
//   fulfilledPct    = floor(mean of criterion scores)                               (fulfilledFromCriteria; also in split.wasm)
// v4 (AGENT_PROMPT_VERSION=v4, default): every criterion also carries a burden-of-proof basis —
//   "admission" (buyer says it's satisfied) and "undisputed" (not disputed, nothing contradicts it) ⇒ verdict must be "met";
//   "evidence" (disputed, judged on evidence) ⇒ any verdict. Absent on v3 rulings.
type CriterionResult = { index: number; verdict: "met" | "partial" | "not_met"; satisfied?: number; total?: number; // counts required for partial
  basis?: "admission" | "undisputed" | "evidence";
  rationale: string; evidenceRefs: string[] };
type CriteriaScore = { id: string; fulfilledPct: number; criteria: CriterionResult[] }; // criteria sorted by index, one per SOW acceptance criterion

// reasoningHash = hashJson(Reasoning) (shared/src/hash.ts: RFC 8785 → keccak256). Stored in dispute_rulings; /verify recomputes it.
// buyerBps = computeBuyerBps(sow.deliverables, scores) (shared/src/split.ts). Scores are in SOW deliverable order; hashes lowercase.
type Reasoning = { dealId: number; sowHash: string; deliveryHash: string; evidenceHash: string;
  scores: DisputeScores["scores"] | CriteriaScore[]; buyerBps: number; model: string; promptVersion: string };
// verifyRuling also returns fulfilledMatches: boolean | null — v3: every fulfilledPct recomputed from its verdicts; null for v1/v2.

// Agent rulings omit `source` (missing = "agent"), so their hashes are unchanged. Arbitrator rulings are stored by B1
// with `reasoningHash = store.saveRuling(ruling)` (= hashJson(ruling)) and then passed to arbitrate():
// minimal { source: "arbitrator", dealId, sowHash, buyerBps, ruling }, extra fields allowed (they are hashed too).
type ArbitratorReasoning = { source: "arbitrator"; dealId: number; sowHash: string; buyerBps: number; ruling: string; [extra: string]: unknown };

// shared/src/verify.ts verifyRuling() — run it in the browser too (with split.wasm, on-chain hash read from MST directly).
// Input: { reasoning, onchainReasoningHash, onchainProposedBps?, settled?: { toBuyer, amount }, sow, wasm? }
type VerifyResult = {
  source: "agent" | "arbitrator";
  hashMatches: boolean;              // hashJson(reasoning) === on-chain reasoningHash
  bpsMatchesFormula: boolean | null; // agent: buyerBps === computeBuyerBps(sow.deliverables, scores); arbitrator: null (human decision)
  bpsMatchesOnchain: boolean | null; // agent: buyerBps === on-chain proposedBuyerBps; arbitrator: null (arbitrate() leaves it stale)
  settledMatches: boolean | null;    // floor(amount × buyerBps / 10000) === Settled.toBuyer (null if no settlement)
  wasmMatchesTs: boolean | null;     // split.wasm result === split.ts result (null if no wasm, or arbitrator)
  sowMatches: boolean;               // reasoning.sowHash === hashSow(sow)
  recomputedHash: string; recomputedBps: number | null; ok: boolean }; // ok = no applicable check is false

type Onchain = { reasoningHash: string; proposedBuyerBps: number; status: Deal["status"] | "None";
  settled?: { toBuyer: string; toSeller: string } }; // from the Settled event, only when status is "Resolved"
// One row per acceptance criterion; `criterion` is the SOW text, `basis` is the v4 badge.
type ResolutionRow = { deliverableId: string; index: number; criterion: string; verdict: "met" | "partial" | "not_met";
  satisfied?: number; total?: number; basis?: "admission" | "undisputed" | "evidence"; rationale: string; evidenceRefs: string[] };

type VerifyResponse =
  | { dealId: number; source: "agent" | "arbitrator"; verifiable: true; reasoning: Reasoning | ArbitratorReasoning; sow: SOW; onchain: Onchain; result: VerifyResult;
      resolution?: ResolutionRow[] } // v3/v4 agent rulings: flat per-criterion rows for the resolution screen
  | { dealId: number; source: "agent" | "arbitrator"; verifiable: false; reason: string; reasoning: Reasoning | ArbitratorReasoning; onchain: Onchain } // no linked SOW
  | { dealId: number; source: "arbitrator-or-unknown"; verifiable: false; onchain: Onchain }; // hash not in dispute_rulings
```
