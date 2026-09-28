# API — B1 (chain & data) endpoints

Flask backend, default `http://localhost:5000`. **Draft — B1 + B2 freeze at hour 1.** Change it only in the same commit as the code.

## Connecting the frontend (the "API key" part)

Every request except `GET /health` must carry:

```
X-API-Key: <API_KEY from backend/.env>
```

Admin routes (`/admin/*`, `/arbitrator/*`) also need `X-Admin-Token: <ADMIN_TOKEN>`.
CORS allows the origins in `CORS_ORIGINS` (default `http://localhost:3000`).

```ts
// frontend/lib/api.ts
const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";
const KEY = process.env.NEXT_PUBLIC_API_KEY!;          // frontend/.env.local

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const res = await fetch(BASE + path, {
    ...init,
    headers: { "X-API-Key": KEY, ...(isForm ? {} : { "Content-Type": "application/json" }), ...init.headers },
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error?.message ?? "Request failed"), data.error);
  return data as T;
}
```

`NEXT_PUBLIC_*` values are visible in the browser, so `API_KEY` is a shared demo secret that keeps random callers out. It is **not** user auth. `ADMIN_TOKEN` must never be in the public frontend build: the arbitrator console should ask the operator to type it.
Real authorization is on-chain: the contract rejects any user action not signed by the right wallet.

## Errors

All errors: `{ "error": { "code": "...", "message": "human readable", ...extras } }`

| HTTP | code | meaning |
|---|---|---|
| 401 | `unauthorized` | bad/missing `X-API-Key` |
| 403 | `forbidden` | bad/missing `X-Admin-Token` |
| 403 | `not_party` `not_buyer` `not_seller` `not_agent` `not_arbitrator` `not_owner` `kyc_required` | contract reverts, decoded |
| 409 | `bad_status` (extra: `current_status`) `too_early` `insufficient_balance` `insufficient_allowance` | contract reverts, decoded |
| 400 | `invalid_params` `bad_address` `bad_request` `empty_submission` | |
| 404 | `deal_not_found` | |
| 502 | `scorer_unavailable` `bad_scores` `split_mismatch` `chain_error` | upstream problem |
| 503 | `not_configured` | `.env` incomplete (escrow address / key missing) |

Use `error.message` directly in the UI toast.

## Endpoints

Amounts are strings in 6-decimals base units (`"100000000"` = 100 mUSD) plus a `...Formatted` twin. `bytes32` values are `0x…` hex. Timestamps are unix seconds.

### Public / config
| | |
|---|---|
| `GET /health` | no auth. `{ok, chain:{connected,chain_id,block}, escrowConfigured, indexer:{lastBlock,lastError}}` |
| `GET /config` | `{chainId, rpcUrl, explorerUrl, escrowAddress, usdAddress, usdDecimals, nativeSymbol, systemWallets:{org,agent,arbitrator}, statuses[]}`. FE builds its viem chain + contract config from this. |
| `GET /contracts/abi` | `{DealEscrow:[…], MockUSD:[…]}` |

### Users & KYC
| | |
|---|---|
| `POST /users` | JSON `{address, handle?, saralId?, kycLevel?}` → user row. Never lowers `kyc_level`. Call after wallet login (PG's `/auth/saral` can call the same logic). |
| `GET /users/:address` | `{address, kyc_level, kycOnChain, kycTxUrl, mstcBalance, musdBalance, musdBalanceFormatted, …}` |
| `POST /kyc/submit` | multipart: `address`, `file` → `{kyc_level:1, status:"pending_review"}` |
| `POST /admin/kyc/:address/approve` | admin. Calls `setKyc`, sets level 2, runs gas drip → `{kyc_level:2, txHash, explorerUrl, gasDrip:{dripped,…}}` |

### Deals
| | |
|---|---|
| `GET /deals?address=0x…&role=buyer\|seller` | list from the index (`id, buyer, seller, amount, amountFormatted, status, …`) |
| `GET /deals/:id` | full view (below) |
| `GET /deals/:id/events` | just the timeline |
| `POST /deals/:id/link-draft` | JSON `{draftId, version?}` — FE calls after the buyer's `proposeDeal` receipt, so the deal knows its SOW |
| `POST /deals/:id/delivery` | multipart: `address` (must be seller), `file`(s), `note?` → `{hash, files[]}`. FE then has the seller sign `markDelivered(id, hash)` |
| `POST /deals/:id/evidence` | multipart: `address` (buyer or seller), `complaint`/`note`, `file`(s) → `{hash, files[]}`. FE then has the user sign `raiseDispute(id, hash)` |
| `POST /deals/:id/resolve` | after `DisputeRaised`. Scores → formula → agent wallet `proposeResolution` → `{scores, buyerBps, reasoningHash, stub, txHash, explorerUrl}` |
| `POST /deals/:id/timeout` | `claimTimeout` (ORG pays gas; payees fixed by contract) → `{txHash, explorerUrl, status}` |

**Hash rule** (so the FE/verify page can recompute): one file and no note → `keccak256(fileBytes)`; otherwise `keccak256(canonicalJson({note, files:[{name,keccak}…sorted by keccak]}))`.

**`GET /deals/:id`** →
```jsonc
{
  "id": 3, "draftId": 1,
  "onchain": { "buyer","seller","amount":"100000000","amountFormatted":"100","status":"Funded",
               "sowHash","deliveryHash","evidenceHash","reasoningHash","deliverBy","reviewPeriod","deliveredAt",
               "reviewEndsAt", "proposedBuyerBps","buyerAccepted","sellerAccepted",
               "escrowBalance","escrowBalanceFormatted" },
  "sow": { /* SOW JSON matching onchain.sowHash, or null */ },
  "reasoning": { "hash","source":"agent|agent-stub|arbitrator|seed","data":{ scores, buyerBps, … } } | null,
  "timeline": [ { "name":"DealFunded","actor","args":{…},"txHash","block","timestamp","explorerUrl" } ],
  "submissions": [ { "kind","address","note","bundle_hash","created_at" } ],
  "files": [ { "kind","address","name","keccak","bundle_hash" } ],
  "escrowUrl": "https://…/address/0x…"
}
```
`status` ∈ `Proposed Accepted Funded Delivered Disputed ResolutionProposed Escalated Released Refunded Resolved Cancelled`.
The chain is the source of truth for `onchain.*`; `timeline` comes from the indexer (a few seconds behind).

### Arbitrator (admin token)
| | |
|---|---|
| `GET /arbitrator/deals` | escalated deals |
| `POST /arbitrator/deals/:id/rule` | JSON `{buyerBps:0..10000, rationale}` → `{txHash, explorerUrl, reasoningHash}` |

## Who signs what

| Action | Signer | Where |
|---|---|---|
| `setKyc`, `fundFor`, `claimTimeout`, gas drip, mint | ORG wallet | backend |
| `proposeResolution` | Agent wallet | backend (`/resolve`) |
| `arbitrate` | Arbitrator wallet | backend (`/arbitrator/.../rule`) |
| `proposeDeal`, `acceptDeal`, `markDelivered`, `release`, `raiseDispute`, `acceptResolution`, `escalate`, `cancelDeal`, `fund` | **User wallet** | frontend (viem) |

## For B2 — scorer contract

If `B2_SCORER_URL` is set, `/resolve` POSTs `{dealId, sowHash, sow, delivery:{note,bundleHash,files}, evidence:{…}, deliveryHash, evidenceHash}` and expects
`{scores:[{id,fulfilledPct(int 0-100),rationale,evidenceRefs}], reasoningHash, reasoning, buyerBps?}`.
B1 **recomputes `buyerBps` with the formula** and rejects the response (`split_mismatch`) if B2's number differs, so the LLM can never sway the split. With `USE_STUB_SCORER=1` a flagged stub returns scores cycling 100/50/0.
Tables `drafts` and `sow_versions` exist already in `backend/app/db.py`. B2 can use them.
