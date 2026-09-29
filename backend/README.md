# backend

One Express 5 + SQLite (better-sqlite3) + viem service for every role. TypeScript runs directly with `tsx`
(no build step). Interfaces are frozen in [`../docs/API.md`](../docs/API.md); security rules in
[`../SECURITY.md`](../SECURITY.md).

## Run

```bash
cd ../shared && npm ci          # the backend imports @kernel-exploits/shared (install it first)
cd ../backend && npm ci
cp .env.example .env            # every variable is documented there
npm run dev                     # http://localhost:5000, reloads on change
npm start                       # production-style start (node --import tsx)
```

`npm test` (vitest, no network), `npm run typecheck`. Demo data: `npm run seed` / `npm run reset` (B1, needs deployed
contracts), `npm run seed:demo` (B2's four dispute scenarios). LLM tools: `npm run models`, `npm run smoke:merge`,
`npm run smoke:score`, `npm run eval:disputes`.

In production (`NODE_ENV=production`) the server **refuses to start** with dev auth, weak or missing secrets, a
wildcard CORS or the demo fallbacks on. See [`../docs/DEPLOY.md`](../docs/DEPLOY.md).

## Layout

| Path | Owner | What |
|---|---|---|
| `src/index.ts`, `src/app.ts` | B1 | server start (timeouts, graceful shutdown) / the app: security middleware, then every router |
| `src/security.ts` | — | production config guard, CORS allowlist, headers, rate limits, admin token, upload limits, error handler |
| `src/chain.ts`, `src/indexer.ts`, `src/db.ts` | B1 | viem clients + system wallets, event indexer (→ `chain_events`, `deals`, `payouts`), SQLite schema |
| `src/dealView.ts`, `src/dealAccess.ts` | B1 | the one `Deal` shape (on-chain `getDeal` + local data); party / arbitrator guards |
| `src/routes/{deals,kyc,resolve}.ts` | B1 | deal reads, delivery/evidence uploads, complaints, resolutions, KYC, AI dispute + arbitration |
| `src/auth.ts`, `src/payments/` | PG | wallet sign-in + sessions (`getCaller`), UPI on-ramp → mint → `fundFor`, gas drip |
| `src/accounts.ts` | — | device binding, security PIN (scrypt), profile, contact lookup, people; device-key registry |
| `src/sow/`, `src/agent/` | B2 | `/drafts/*` negotiation + SOW store, AI merge and dispute scoring, `/deals/:id/{sow,agreement,verify}` |

## Endpoints

| Method | Path | Who |
|---|---|---|
| GET | `/health` | anyone |
| GET | `/auth/nonce` · POST `/auth/verify` · POST `/auth/logout` | wallet sign-in (PG) |
| POST | `/auth/device/bind` · `/auth/new-device` · `/auth/pin` · `/auth/pin/verify` · `/auth/device` | signed in |
| GET | `/users/me` · `/users/by-phone/:phone` · `/people` | signed in |
| POST | `/kyc/submit` | signed in (own wallet) |
| POST | `/admin/kyc/:address/approve` | `X-Admin-Token` |
| GET/POST/PATCH | `/drafts`, `/drafts/:id`, `/drafts/:id/{sow,terms,merge-sow,conflicts,approve-sow,link}` | the draft's parties |
| GET | `/deals?address=`, `/deals/:id`, `/deals/:id/{sow,agreement,complaint,resolution}` | the deal's parties (or an arbitrator) |
| GET | `/deals/:id/verify` | anyone (public verification) |
| POST | `/deals/:id/delivery` (seller) · `/deals/:id/evidence` · `/deals/:id/resolve` · `/deals/:id/timeout` | the deal's parties, checked on-chain |
| GET | `/arbitrator/cases` · POST `/arbitrator/deals/:id/rule` | arbitrator wallet (`ARBITRATOR_ADDRESSES`) or `X-Admin-Token` |
| POST | `/onramp/:dealId/session` · `/onramp/:dealId/confirm` · GET `/deals/:id/payment` | `X-API-Key` (PG) |

Signed in = PG's session cookie (from `/auth/verify`). Every route also gets the security headers, the CORS allowlist
and per-IP rate limits. Users sign the escrow's own actions (`markDelivered`, `release`, `raiseDispute`,
`acceptResolution`, `escalate`) with their wallet; the backend only sends the platform's transactions (`fundFor`,
`setKyc`, `proposeResolution`, `arbitrate`, `claimTimeout`).
