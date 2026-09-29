# API — DRAFT (B1 + B2 finalize and freeze by hour 1)

> Base URL: `NEXT_PUBLIC_API_URL`. JSON everywhere. Errors: `{ "error": { "code": "BadStatus", "message": "..." } }`.
> Amounts: strings in token base units (6 decimals) — `"100000000"` = 100 mUSD. Hashes: `0x`-prefixed 32-byte hex.
> Any change after freeze: update this file in the same commit + note under "Interface changes" in your progress log.
> Every route: security headers, an exact-origin CORS allowlist (`CORS_ORIGINS`, credentials allowed), per-IP rate limits → `429 { error: { code: "RateLimited" } }`, JSON bodies ≤ 100 KB (`413`), generic `500 { error: { code: "Internal" } }`. `GET /arbitrator/cases` needs `x-admin-token`. See `SECURITY.md`.

## Auth & KYC
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| GET | `/auth/nonce?address=0x..` | PG | → `{ nonce, chainId, domain, issuedAt, expirationTime, messageToSign }` (single-use nonce; expires in 5 minutes) |
| POST | `/auth/verify` | PG | `{ message, signature }` → `{ user, expiresIn }` plus HttpOnly `mst_session` cookie |
| POST | `/auth/logout` | PG | — → `204` and clears the session cookie |
| POST | `/auth/saral` | PG | `{ address, saralSessionProof }` → `503` until mentor docs and a docs-backed verifier are available |
| POST | `/kyc/submit` | B1 | multipart `name`, `phone` (10-digit mobile), `pan` (**never stored**), `file` (one ID document ≤ 10 MB) → `Account`. **Signed-in only**, for the caller's own wallet (an `address` field that differs → 403). Phone must be unique (409 `PhoneTaken`) |
| POST | `/auth/device/bind` | — | `{ deviceId, deviceKey }` → `{ status: "ok", user: Account } \| { status: "pin_required" }`. First device, or the account's own device → bound. An account with a PIN that is bound to another device needs `/auth/new-device` |
| POST | `/auth/new-device` | — | `{ deviceId, pin }` → `Account`. Within 5 min of the bind attempt; moves the account to this device, de-registers the old one, starts a 24 h cooling period (`coolingUntil`) |
| POST | `/auth/pin` | — | `{ deviceId, pin }` → `Account`. Once, from the bound device; 4 digits, not repeated or sequential (400 `WeakPin`) |
| POST | `/auth/pin/verify` | — | `{ pin }` → `{ ok: true }`. Wrong → 403 `WrongPin` (attempts left); 5 wrong → 429 `PinLocked` for 5 min. Stored as salted scrypt |
| POST | `/auth/device` | — | `{ deviceId }` → `{ valid }` (false once the account moved to another device) |
| GET | `/users/me` | — | → `Account` |
| GET | `/users/by-phone/:phone` | — | → `Contact \| null` (users with a name + KYC ≥ 1). Signed-in only; rate-limited |
| GET | `/people?address=` | — | → `Contact[]`: counterparts from your drafts and deals, most recent first. Own list only |
| POST | `/admin/kyc/:address/approve` | B1 | header `x-admin-token` → `{ txHash }` (the API key alone → 401) |

## Drafts & SOW
> B2's router, mounted by B1: `app.use(createSowRouter({ store, getCaller, isAuthorizedSigner }))`. Paths are `/drafts/*` so they never clash with B1's on-chain `/deals/:id`.
> Caller identity: the `getCaller` injected into `createSowRouter` / `createDisputeRouter` (B1 passes PG's `getCaller` from `backend/src/auth.ts`: session cookie; the `x-user-address: 0x…` header **only** when `AUTH_DEV_HEADER=true`). B2's default `getCaller` (`backend/src/sow/auth.ts`) has no sessions: header iff `AUTH_DEV_HEADER=true`, else nobody is signed in. No identity → **401** `{ "error": { "code": "Unauthorized", "message" } }`; signed in but not a party (or acting as the other party) → 403 `Forbidden`.
> `X-API-Key`: if the deployment requires it, B1 applies PG's `requireApiKey` (`X-API-Key` = `BACKEND_API_KEY`) in front of these routers at mount time; the routers themselves don't check it.
> Flow: either side creates a draft with its terms → the other side adds its terms → `merge-sow` → settle structured conflicts via `/conflicts` → both parties `approve-sow` (optionally signed) the same version → buyer sends `proposeDeal(proposeDealArgs)` → `link`.

| Method | Path | Owner | Body → Response |
|---|---|---|---|
| POST | `/drafts` | B2 | `{ initiator: "buyer"\|"seller", counterparty: address, purpose, amount \| price, terms, deliveryDeadline?, reviewWindowSecs? }` → `Draft` (201). The caller is the initiator's side; `buyer`/`seller` are derived from `initiator` + `counterparty` (≠ caller). `amount` (alias `price`; both given → must be equal) is a base-unit string > 0. Defaults: `deliveryDeadline = now + DEFAULT_DELIVERY_DAYS (7) days`, `reviewWindowSecs = DEFAULT_REVIEW_SECS (172800)`; a deadline must be in the future. **Legacy body still accepted:** `{ buyer, seller, purpose, buyerConstraints, amount, deliveryDeadline, reviewWindowSecs }` (caller must be `buyer`) |
| GET | `/drafts?address=0x…` | B2 | → `Draft[]` where the address is buyer or seller, newest first. `address` defaults to the caller and must equal it (else 403) |
| GET | `/drafts/:id` | B2 | → `Draft & { latestSow: SowVersion \| null }` (parties only) |
| GET | `/drafts/:id/sow` | B2 | → latest `SowVersion` or `null` (parties only) |
| POST | `/drafts/:id/terms` | B2 | `{ party, terms }` → `Draft`. Only the side that did **not** create the draft (caller must be `party`), else 403. Status → `ready_to_merge`. 409 once linked. Alias: `POST /drafts/:id/seller-input { sellerPoints }` (= `{ party: "seller", terms }`, same rules) |
| PATCH | `/drafts/:id/terms` | B2 | any of `{ amount, deliveryDeadline, reviewWindowSecs }` → `Draft & { latestSow }`. Buyer only; 409 once linked. If a SOW exists, a new version is rebuilt from it with the new terms (no LLM call), re-hashed; approvals and signatures reset; open conflicts carry over |
| POST | `/drafts/:id/merge-sow` | B2 | — → `SowVersion` (new version, approvals reset). Needs both sides' terms (409 otherwise). `conflicts` holds a `deliveryDeadline` Conflict when the agent read different delivery days from the two sides' terms; the agent's text conflicts are in `conflictNotes`. 422 `SowValidationFailed` if the agent can't produce a valid SOW after 1 retry; 502 `LlmUnavailable` |
| POST | `/drafts/:id/conflicts` | B2 | `{ party, field: "deliveryDeadline", value: unix s }` → `SowVersion`. Caller must be `party`. Records the proposal on the latest version's open conflict (409 `NoOpenConflict` if none; `value` must be in the future). When both parties' proposals are equal the conflict resolves: a **new version** is rebuilt with that `deliveryDeadline` (no LLM call, same path as PATCH `/terms`), signatures reset |
| POST | `/drafts/:id/approve-sow` | B2 | `{ party, version, signature?, pin? }` → `SowVersion & { bothApproved, proposeDealArgs? }`. `version` must be the latest (409 `StaleVersion`); 409 `ConflictsOpen` while the latest version has any conflict; 409 `DeadlinePassed` / `TokenMismatch` block the final approval. **Signature:** `signMessage({ message: { raw: sowHash } })`; the backend recovers the signer (`recoverMessageAddress`) and accepts it when signer = caller, or when `isAuthorizedSigner(caller, signer)` (PG/FE device-key registry, injected by B1; default: none) allows it — else 403 `SignerNotAuthorized` (400 `BadSignature` if malformed). Stored as a `Signature`. **`pin`** is accepted and ignored (device security is PG/FE's). Both parties on the same version → `status: "signed"` and `proposeDealArgs` |
| POST | `/drafts/:id/link` | B2 | `{ dealId, txHash }` → `Draft` (buyer only, after both approved; `stage` → `linked`, `dealId` set). Reads the receipt from MST: it must succeed, be sent to `ESCROW_ADDRESS`, and emit `DealProposed` with matching id, buyer, seller, amount and the approved `sowHash`. Otherwise 422 `LinkVerificationFailed` with the specific mismatch; 502 `ChainUnavailable` if the RPC fails |

## Deals (on-chain backed)
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| GET | `/deals?address=0x..` | B1 | → `Deal[]` (plain array) for the signed-in wallet; `address`, if given, must be the caller's |
| GET | `/deals/:id` | B1 | → `Deal`. The deal's parties (on-chain) or an arbitrator; 404 unknown; 502 chain unavailable |
| GET | `/deals/:id/complaint` | B1 | → `Complaint \| null` (parties or an arbitrator) |
| GET | `/deals/:id/resolution` | B1 (B2's ruling) | → `Resolution` = the AI agent's `{ scores, buyerBps }`; 404 `NoResolution` until proposed |
| GET | `/arbitrator/cases` | B1 | → `Deal[]` that are `Escalated` or already ruled by an arbitrator. Arbitrator wallet (`ARBITRATOR_ADDRESSES`) or `x-admin-token` |
| POST | `/deals/:id/delivery` | B1 | multipart `files[]` (≤ 5 × 10 MB) → `{ hash }`. The caller must be the deal's **seller** on-chain (403 otherwise, 404 unknown deal) |
| POST | `/deals/:id/evidence` | B1 | multipart `files[]`, `complaint` → `{ hash }`. Caller must be the deal's buyer or seller on-chain |
| POST | `/deals/:id/resolve` | B1 (calls B2) | `{ complaintText?, deliveryNotes?, evidenceNotes? }` → `{ scores, buyerBps, reasoningHash, txHash }`. Caller must be a party on-chain; rate-limited; 409 `NoSow`, 422 `ScoringFailed`, 502 `LlmUnavailable` |
| POST | `/deals/:id/timeout` | B1 | — → `{ txHash }`. Caller must be a party on-chain; rate-limited |
| GET | `/deals/:id/sow` | B2 | → `SowVersion` of the draft linked to deal `:id` (with signatures). Parties of the deal only (401/403); 404 `NotFound` if no linked SOW; 400 for a bad id. **Alias:** `GET /deals/:id/agreement`. Mounted via `createDisputeRouter({ store, getCaller })` |
| GET | `/deals/:id/verify` | B2 | → `VerifyResponse` (below). Reads `getDeal(id)` on MST. 404 `NoRuling` when there's no `reasoningHash` on-chain yet; 404 `NotFound` for an unknown deal; 400 for a bad id; 502 `ChainUnavailable`. Mounted via `createDisputeRouter()` |
| POST | `/arbitrator/deals/:id/rule` | B1 | `{ buyerBps (0–10000), ruling \| note }` → `Deal & { reasoningHash, txHash }`. Arbitrator wallet or `x-admin-token`; the ruling is stored (`saveRuling`) before `arbitrate()` so it verifies |

> **Party actions are signed by the user's own wallet**, not the backend: `markDelivered(id, hash)` (hash from `/deals/:id/delivery`), `raiseDispute(id, hash)` (hash from `/deals/:id/evidence`), `release(id)`, `acceptResolution(id)`, `escalate(id)` on `DealEscrow`. Delivery/evidence return `hash` = the single file's keccak256, or `hashJson({ files: [keccak…], note })` when there is a note or several files.

## Payments
| Method | Path | Owner | Body → Response |
|---|---|---|---|
| POST | `/onramp/:dealId/session` | PG | — → `{ paymentId, amountInr, amountUsd, status, upi: { payee, note }, upiUri }` |
| POST | `/onramp/:dealId/confirm` | PG | `{ method: "upi_qr"|"upi_id"|"upi_app"|"crypto" }` → `{ status, mintTx, fundTx }` (idempotent; mint/fund hashes may be `null` until submitted) |
| GET | `/deals/:id/payment` | PG | → `{ payment: Payment|null, payout: Payout|null }` |

### PG payment details
- `amountUsd`, `payment.amount`, `payout.toBuyer`, and `payout.toSeller` are decimal integer strings in MockUSD base units (6 decimals), unless the field name ends in `Formatted`.
- The demo quote is fixed at ₹84 per 1 MockUSD. The on-ramp session amount is sourced from the on-chain deal; clients do not submit an amount.
- The UPI payee/note are mock display data only. `/confirm` represents the demo user's confirmation; it is not proof of an external fiat transfer.
- `upiUri` is a display/QR payload built from the mock payee, note, and INR amount. The required confirmation `method` is stored on the payment row for display only; it does not prove an external transfer or change settlement behavior. Payment history includes `method` as `upi_qr`, `upi_id`, `upi_app`, `crypto`, or `null` before a method is selected.
- PG payment routes use the shared backend `X-API-Key` middleware. Wallet auth endpoints are public. Wallet login first obtains a server-stored, single-use 5-minute nonce, then signs the returned EIP-4361-style message for chain `91562037`. `/auth/verify` checks the configured `AUTH_DOMAIN`, exact URI, chain, nonce, issue/expiry times, and signature before setting a one-hour `HttpOnly; SameSite=Lax` session cookie (`Secure` in production). Configure `AUTH_SESSION_SECRET` to at least 32 bytes and `AUTH_DOMAIN`; `AUTH_URI` can override the default `https://${AUTH_DOMAIN}`.
- `getCaller(req)` returns only the address in a valid signed session cookie. `x-user-address` is ignored unless `AUTH_DEV_HEADER=true`; keep that disabled outside local tests. The demo API key remains application-level access control, not a per-user session token.
- SARAL is fail-closed. `SARAL_ENABLED` defaults to `false`; the route and connector return `SARAL not configured: awaiting mentor docs` until mentor docs arrive. No SARAL SDK calls, package names or proof formats are assumed. If those docs provide an EIP-1193 provider, it can use the injected-wallet flow; a session-proof flow needs a separately documented verifier.
- `GET /deals/:id/payment` reads settlement amounts indexed by B1 from `Settled` events; both payout amount fields are formatted using 6 MockUSD decimals.

## PG wallet and transaction module (frontend handoff)
- The browser modules currently live under `backend/src/auth/`. FE must not bundle code from the backend. B2 owns `shared/`; PG has requested that B2 publish/export `wallet-connector.ts` and `transaction-helper.ts` from `@kernel-exploits/shared`. FE should import them from that package after B2 completes the export. Discovery listens for EIP-6963 announcements, lists MetaMask and BridgeKey only when they announce a standard EIP-1193 provider, and falls back to `window.ethereum` when no supported announcement is available. The BridgeKey extension was not available for a live check in this checkout.
- Call `connector.connect()` to request accounts and ensure chain `91562037` (`0x5752035`). If the chain is unknown, the connector adds MST Testnet using tMSTC, the documented MST RPC, and explorer. A code `4001` rejection becomes a user-readable error. Subscribe with `onAccountsChanged`; use `bindWalletSession(connector, { onLoginRequired })` to POST `/auth/logout` and prompt SIWE login again after an account change. Subscribe to `onChainChanged` to disable actions until the wallet returns to MST Testnet; `getWalletClient()` also enforces this check before each action.
- After login call `getTestGasStatus(publicClient, address)`. When balance is below `0.05` tMSTC, display its `message` (“Getting you test gas…”) while B1 runs the PG gas-drip hook after KYC approval. Show its `faucetUrl` (`https://faucet.mstblockchain.com/`) as a fallback.
- Use `sendPgContractAction({ connector, publicClient, contractAddress, abi, action, args })` for `proposeDeal`, `acceptDeal`, `markDelivered`, `release`, `raiseDispute`, `acceptResolution`, `escalate`, and `fund`. It waits for a successful receipt and returns `{ txHash, explorerUrl }`; reverted receipts throw an error. The explorer link is `https://testnet.mstscan.com/tx/<hash>`.
- SARAL remains dropped from the hackathon flow. Keep `SARAL_ENABLED=false`; its connector remains a fail-closed placeholder pending official docs.

## Shapes
```ts
type User = { address: string; handle?: string; kycLevel: 0 | 1 | 2 };

type Payment = {
  id: string; dealId: number; amount: string; status: "created"|"paid"|"minted"|"funded"|"failed";
  method?: "upi_qr"|"upi_id"|"upi_app"|"crypto"|null;
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

// FE shapes (frontend/lib/types.ts). Responses are supersets: FE's fields first, then ours.
type Party = "buyer" | "seller";
type Draft = { id: string; initiator: Party; buyer: string; seller: string;
  buyerName: string | null; sellerName: string | null;   // always null from B2 (PG/FE resolve names)
  purpose: string; price: string;                         // base units; = amount
  buyerTerms?: string; sellerTerms?: string;              // each side's terms (absent until given)
  status: "awaiting_other" | "ready_to_merge" | "merged" | "signed"; // merged = a SOW exists; signed = both approved one version
  dealId?: string;                                        // once linked
  createdAt: number;                                      // unix s
  // B2 extras:
  amount: string; buyerConstraints?: string; sellerPoints?: string; deliveryDeadline: number; reviewWindowSecs: number;
  stage: "awaiting_other" | "ready_to_merge" | "sow_proposed" | "approved" | "linked"; // internal lifecycle ("awaiting_seller" on old rows)
  latestSowVersion?: number; linkTxHash?: string; updatedAt: number };

type Conflict = { field: "deliveryDeadline"; label: string; // "Delivery deadline"
  buyerWants: number; sellerWants: number;                 // unix s = draft createdAt + requested days × 86400
  proposals: { buyer?: number; seller?: number } };        // unix s; equal → resolved (new version)
type Signature = { party: Party; signer: string; signature: string; signedAt: number }; // signer may be a device key
type SowVersion = { draftId: string; version: number; sow: SOW; sowHash: string; conflicts: Conflict[]; signatures: Signature[];
  // B2 extras:
  conflictNotes: string[];                                 // agent's free-text conflicts + "[server] …" notes
  approvals: { buyer: boolean; seller: boolean }; createdAt: number };

// Exactly the args for DealEscrow.proposeDeal, derived only from the stored SOW (never differs from what was hashed).
type ProposeDealArgs = { seller: string; amount: string; sowHash: string; deliverBy: number; reviewPeriod: number };

type ChainEvent = { name: string; args: Record<string, string>; txHash: string; block: number; timestamp: number };

// The one Deal shape (backend/src/dealView.ts = frontend/lib/types.ts). Parties/amount/status/hashes from on-chain getDeal.
type Deal = {
  id: string; draftId: string; title: string;                    // title/draftId from the linked SOW ("" / "Deal <id>" if none)
  buyer: string; seller: string; buyerName: string; sellerName: string; amount: string;
  status: "Proposed"|"Accepted"|"Funded"|"Delivered"|"Disputed"|"ResolutionProposed"|"Escalated"|"Released"|"Refunded"|"Resolved"|"Cancelled";
  sowHash: string; deliverBy: number; reviewPeriod: number; deliveredAt?: number; deliveryNote?: string;
  buyerBps?: number;                                              // proposed / ruled refund share
  accepted?: { buyer: boolean; seller: boolean };                 // while ResolutionProposed
  ruledBy?: "ai" | "arbitrator"; arbitratorNote?: string; paidWith?: "upi_qr"|"upi_id"|"upi_app"|"crypto";
  events: (ChainEvent & { logIndex: number })[];
};
type Account = { address: string; phone: string; name?: string; role: "user" | "arbitrator"; deviceId: string; deviceKey?: string;
  kycLevel: 0 | 1 | 2; hasPin: boolean; deviceBoundAt?: number; coolingUntil?: number };      // = frontend `User`
type Contact = { phone: string; name: string; bankingName: string; address: string; lastActivity?: number };
type Complaint = { dealId: string; raisedBy: "buyer" | "seller"; text: string; deliverableIds: string[];
  attachments: { name: string; type: string; size: number }[]; createdAt: number };
type Resolution = { scores: { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] }[]; buyerBps: number };

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
