# backend_b1_node — B1 (Backend: Chain & Data)

Node + Express + TypeScript + SQLite (better-sqlite3) + viem, following
`docs/TEAM_ROADMAP.md` §1 exactly.

## Setup

```bash
cd backend_b1_node
npm install
copy .env.example .env     # Windows; Mac/Linux: cp .env.example .env
```

Fill `.env` with:
- `ESCROW_ADDRESS` / `USD_ADDRESS` — from `deployments.md` once contracts are deployed
- `ORG_KEY` / `AGENT_KEY` / `ARBITRATOR_KEY` — the 3 system wallets B1 generates (`cast wallet new` ×5 per the roadmap)
- `BACKEND_API_KEY` — any string; the frontend sends it back in `X-API-Key`
- `DEPLOY_BLOCK` — the block the contracts were deployed at (so the indexer backfill doesn't scan the whole chain)

## Run (dev, auto-reload)

```bash
npm run dev
```

## Run (built)

```bash
npm run build
npm start
```

Starts on `http://localhost:5000`. `GET /health` for a liveness check.
The indexer starts automatically: it backfills from `DEPLOY_BLOCK`, then
watches escrow contract events live over the WebSocket RPC. Inserts are
idempotent (`(tx_hash, log_index)` primary key), so restarts never lose or
duplicate history.

## Endpoints so far

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | none | liveness check |
| POST | `/kyc/submit` | X-API-Key | multipart: `address`, `file` — mock KYC upload |
| POST | `/admin/kyc/:address/approve` | X-API-Key | `setKyc(address, true)` from ORG wallet |
| GET | `/deals/:id` | X-API-Key | merges on-chain `getDeal` + local `chain_events` |
| POST | `/deals/:id/delivery` | X-API-Key | multipart: `file` — returns keccak256 hash to sign `markDelivered` |
| POST | `/deals/:id/evidence` | X-API-Key | multipart: `file` — returns keccak256 hash to sign `raiseDispute` |

Still to build per the roadmap: `/deals/:id/resolve` (calls B2's `scoreDispute()`),
`/arbitrator/deals/:id/rule`, `/deals/:id/timeout`, and mapping every contract
revert (`BadStatus`, `NotParty`, `TooEarly`, ...) to a readable HTTP error via
viem's `decodeErrorResult`.

## Frontend connection

Frontend sends `X-API-Key: <BACKEND_API_KEY>` on every request to this backend.
That's separate from wallet signing — users sign their own on-chain actions
(`proposeDeal`, `acceptDeal`, `markDelivered`, `release`, `raiseDispute`, etc.)
in their own wallet in the frontend. This backend only signs with the 3 system
wallets for admin-style calls (KYC approval, agent proposals, arbitration).

## Notes

- The chain is the source of truth for deal status/amounts. SQLite only
  stores drafts, file hashes, and a local mirror of chain events.
- Never commit `.env`.
