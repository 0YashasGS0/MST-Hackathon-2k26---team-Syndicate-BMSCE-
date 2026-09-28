# API — DRAFT (B1 + B2 finalize and freeze by hour 1)

> Base URL: `NEXT_PUBLIC_API_URL`. JSON everywhere. Errors: `{ "error": { "code": "BadStatus", "message": "..." } }`.
> Amounts: strings in token base units (6 decimals) — `"100000000"` = 100 mUSD. Hashes: `0x`-prefixed 32-byte hex.
> Any change after freeze: update this file in the same commit + note under "Interface changes" in your progress log.

## Auth & KYC
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| GET | `/auth/nonce?address=0x..` | PG | → `{ nonce, chainId, domain, issuedAt, expirationTime, messageToSign }` (single-use nonce; expires in 5 minutes) |
| POST | `/auth/verify` | PG | `{ message, signature }` → `{ user, expiresIn }` plus HttpOnly `mst_session` cookie |
| POST | `/auth/logout` | PG | — → `204` and clears the session cookie |
| POST | `/auth/saral` | PG | `{ address, saralSessionProof }` → `503` until mentor docs and a docs-backed verifier are available |
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
| POST | `/onramp/:dealId/session` | PG | — → `{ paymentId, amountInr, amountUsd, status, upi: { payee, note } }` |
| POST | `/onramp/:dealId/confirm` | PG | — → `{ status, mintTx, fundTx }` (idempotent; mint/fund hashes may be `null` until submitted) |
| GET | `/deals/:id/payment` | PG | → `{ payment: Payment|null, payout: Payout|null }` |

### PG payment details
- `amountUsd`, `payment.amount`, `payout.toBuyer`, and `payout.toSeller` are decimal integer strings in MockUSD base units (6 decimals), unless the field name ends in `Formatted`.
- The demo quote is fixed at ₹84 per 1 MockUSD. The on-ramp session amount is sourced from the on-chain deal; clients do not submit an amount.
- The UPI payee/note are mock display data only. `/confirm` represents the demo user's confirmation; it is not proof of an external fiat transfer.
- PG payment routes use the shared backend `X-API-Key` middleware. Wallet auth endpoints are public. Wallet login first obtains a server-stored, single-use 5-minute nonce, then signs the returned EIP-4361-style message for chain `91562037`. `/auth/verify` checks the configured `AUTH_DOMAIN`, exact URI, chain, nonce, issue/expiry times, and signature before setting a one-hour `HttpOnly; SameSite=Lax` session cookie (`Secure` in production). Configure `AUTH_SESSION_SECRET` to at least 32 bytes and `AUTH_DOMAIN`; `AUTH_URI` can override the default `https://${AUTH_DOMAIN}`.
- `getCaller(req)` returns only the address in a valid signed session cookie. `x-user-address` is ignored unless `AUTH_DEV_HEADER=true`; keep that disabled outside local tests. The demo API key remains application-level access control, not a per-user session token.
- SARAL is fail-closed. `SARAL_ENABLED` defaults to `false`; the route and connector return `SARAL not configured: awaiting mentor docs` until mentor docs arrive. No SARAL SDK calls, package names or proof formats are assumed. If those docs provide an EIP-1193 provider, it can use the injected-wallet flow; a session-proof flow needs a separately documented verifier.
- `GET /deals/:id/payment` reads settlement amounts indexed by B1 from `Settled` events; both payout amount fields are formatted using 6 MockUSD decimals.

## Shapes
```ts
type User = { address: string; handle?: string; kycLevel: 0 | 1 | 2 };

type Payment = {
  id: string; dealId: number; amount: string; status: "created"|"paid"|"minted"|"funded"|"failed";
  mintTx: string|null; fundTx: string|null; createdAt: string; amountFormatted: string;
};
type Payout = {
  dealId: number; toBuyer: string; toSeller: string; finalStatus: string; txHash: string;
  toBuyerFormatted: string; toSellerFormatted: string;
};

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
