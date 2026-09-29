# backend — full B1 implementation (Hours 0–10) + PG's home

Node + Express + TypeScript + SQLite (better-sqlite3) + viem, following
`docs/TEAM_ROADMAP.md` §1 end-to-end. This is the **one shared backend**
everyone works inside — PG's payment routes are already mounted here
(`src/routes/payments.ts`) on the same DB, chain clients, and auth as B1's.

## Setup

```bash
cd backend
npm install
copy .env.example .env     # Windows; Mac/Linux: cp .env.example .env
```

Fill `.env`:
- `ESCROW_ADDRESS` / `USD_ADDRESS` — from `deployments.md` once contracts are deployed
- `ORG_KEY` / `AGENT_KEY` / `ARBITRATOR_KEY` — the 3 system wallets (`cast wallet new` ×5 per the roadmap; 2 more are the demo buyer/seller below)
- `BACKEND_API_KEY` — the frontend sends this back in `X-API-Key`
- `ADMIN_TOKEN` — separate token for the arbitrator console only
- `DEPLOY_BLOCK` — block the contracts were deployed at
- `DEMO_BUYER_KEY` / `DEMO_SELLER_KEY` — 2 funded testnet wallets, used only by `scripts/seed.ts`

## Run

```bash
npm run dev      # dev, auto-reload
npm run build && npm start   # production build
```

`GET /health` for a liveness check. The indexer auto-starts: backfills from
`DEPLOY_BLOCK`, then watches escrow events live over the WebSocket RPC.
Inserts are idempotent — restarts never lose or duplicate history.

## Demo readiness (Hour 8–10)

```bash
npm run seed    # creates 4 demo deals: Funded, Delivered, ResolutionProposed, Escalated
npm run reset   # wipes local data/, re-seeds from scratch, in under 2 minutes
```

## All endpoints

| Method | Path | Auth | Owner | Purpose |
|---|---|---|---|---|
| GET | `/health` | none | — | liveness check |
| POST | `/kyc/submit` | X-API-Key | B1 | multipart: `address`, `file` — mock KYC upload |
| POST | `/admin/kyc/:address/approve` | X-API-Key | B1 | `setKyc(address, true)` from ORG wallet |
| GET | `/deals/:id` | X-API-Key | B1 | merges on-chain `getDeal` + local `chain_events` |
| POST | `/deals/:id/delivery` | X-API-Key | B1 | file → keccak256 hash to sign `markDelivered` |
| POST | `/deals/:id/evidence` | X-API-Key | B1 | file → keccak256 hash to sign `raiseDispute` |
| POST | `/deals/:id/resolve` | X-API-Key | B1 | scores dispute (stub, see below), agent calls `proposeResolution` |
| GET | `/deals/:id/verify` | X-API-Key | B1 | full reasoning object for FE's browser-side verify page |
| POST | `/arbitrator/deals/:id/rule` | X-Admin-Token | B1 | human ruling → `arbitrate()` |
| POST | `/deals/:id/timeout` | X-API-Key | B1 | calls `claimTimeout(id)` from ORG wallet |
| POST | `/onramp/:dealId/session` | X-API-Key | PG | creates a payment row, returns mock UPI payload |
| POST | `/onramp/:dealId/confirm` | X-API-Key | PG | idempotent: mint MockUSD → `fundFor(dealId)` |
| GET | `/deals/:id/payment` | X-API-Key | PG | payment + payout records |

Every route maps contract reverts to a clean `{ error, code, message }` JSON body
via `src/errors.ts` (`decodeErrorResult` under the hood) — see done-checklist item
"every contract revert shows up as a clear API error."

## One thing still stubbed: `scoreDispute()`

`src/scoreDispute.ts` is a placeholder — it always returns "fully delivered."
**B2 owns the real version** (calls the LLM, validates JSON, returns
`{ scores, buyerBps, reasoningHash }` — see `docs/TEAM_ROADMAP.md` §2).
Swap the stub body for B2's import once it lands; the function signature is
the agreed contract between B1 and B2, so tell B2 to match it exactly.

## What PG still needs to add (not built here)

- `POST /auth/saral` (SARAL login) and `gasDrip(address)` — §3 "Hour 6-9"
- The SARAL signer adapter for the frontend
- tMUSD / BridgeKey optional extras — §3 "Hour 9-10", only if time allows

Add them to `src/routes/payments.ts` using the same `requireApiKey` + `db` +
`chain.ts` clients already wired in — don't open a second database or a
separate Express app.

## Frontend connection ("the API key thing")

Every route above except the arbitrator console needs:
```
X-API-Key: <BACKEND_API_KEY from .env>
```
The arbitrator route uses a **separate** `X-Admin-Token` header instead, so a
normal frontend key can't rule on disputes.

This is separate from wallet signing: users sign their own on-chain actions
(`proposeDeal`, `acceptDeal`, `markDelivered`, `release`, `raiseDispute`,
`acceptResolution`, `escalate`, `fund`) in their own wallet on the frontend.
This backend only signs with the 3 system wallets for admin-style calls.

## Notes

- The chain is the source of truth for deal status/amounts. SQLite only
  stores drafts, file hashes, reasoning objects, payments, and a local
  mirror of chain events.
- Never commit `.env`.
- ABIs in `abi/` were hand-derived from `DealEscrow.sol`; double check
  `MockUSD.json` against your actual `MockUSD.sol` source once you have it.
