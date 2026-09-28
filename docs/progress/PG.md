# Progress — PG — Payment gateway

> Only this role (and its AI agent) edits this file. Newest entry on top.
> Other agents: read it to know what exists, what changed and what we need from you.

## Current state
- **Working on:** PG-owned payment, auth, and gas-drip integration for B1's shared Node backend
- **Done & usable by others:** base-unit MockUSD mint helper; idempotent on-ramp services and routes; SQLite payments/payouts adapter; B1 viem adapter; nonce-based wallet login with signed session cookie; generic injected EIP-1193 connector; fail-closed SARAL connector stub; gas-drip helper/store
- **Blocked by:** deployed addresses are not in `deployments.md`; B1 needs to mount the PG router and invoke the gas-drip hook; SARAL remains disabled/fail-closed until the mentor SDK documentation arrives

## Requests to others
<!-- Format: - [ ] @B1/@B2/@PG/@FE: what you need — why (hh:mm) -->
- [ ] @nikil-dev (B1): bring `nikil-dev` up to current `main`, confirm the canonical backend path, replace the payments placeholder with `createPgIntegration(...).paymentsRouter`, mount its `authRouter`, and call `gasDripAddress(address)` after KYC approval.
- [ ] @B1/@B2: `getCaller` is now session-based; swap your stub at merge. Read the verified address from the PG `getCaller(req)` helper; the `x-user-address` header is ignored unless `AUTH_DEV_HEADER=true`.
- [ ] @nikil-dev (B1): deploy/verify contracts and fill `deployments.md`; confirm ORG allowance and `DEPLOY_BLOCK`. The current `main` deployment record is blank.
- [ ] @B2: confirm whether any PG endpoint consumes `hashSow` / `hashJson`; current PG flows do not hash SOW or reasoning data.
- [ ] @MST mentors / PG: provide SARAL SDK docs and confirm whether its login returns an EIP-1193 provider or a transaction-signing API. The repository's `docs/sdk/README.md` says SARAL docs have not been received.

## Interface changes
<!-- Any change to endpoints, JSON shapes, ABI, shared/ files. Also update docs/API.md. -->
- `docs/API.md`: session response now specifies `upi: { payee, note }`; payment and payout amounts are specified as MockUSD base-unit strings, with formatted display fields; wallet auth now uses `/auth/nonce`, `/auth/verify`, and `/auth/logout` with a signed session cookie; SARAL remains fail-closed.

## Log
<!-- Copy this template for each finished task, newest first:
### hh:mm — <task title>
- **What:** what was built or changed
- **Files:** paths touched
- **How to use:** endpoint, function or command others can call now
- **Tested:** how it was verified (curl, test, explorer tx link)
- **Next:** what comes next for this role
-->

### 2026-09-29 — Provider-agnostic wallet auth and session caller
- **What:** Replaced raw wallet-message login with a five-minute SQLite nonce and strict EIP-4361-style verification for chain `91562037`. Successful verification consumes the nonce and issues a one-hour HMAC-signed HttpOnly session cookie. `getCaller(req)` reads that verified cookie; `x-user-address` is ignored unless `AUTH_DEV_HEADER=true`. Added a standard injected EIP-1193 wallet connector with chain switch/add handling and a SARAL connector stub that always fails closed. Gas drips persist an address claim and outcome, with one attempt per address. SARAL sponsored transactions are **unknown pending docs**.
- **Files:** `backend/src/auth.ts`, `backend/src/auth/wallet-connector.ts`, `backend/src/payments/b1-integration.ts`, `backend/src/payments/schema.sql`, `backend/src/payments/sqlite-gas-drip-store.ts`, `backend/src/payments/saral-signer.ts` (removed undocumented-ready wrapper), `backend/test/auth.test.ts`, `backend/test/wallet-connector.test.ts`, `docs/API.md`, `docs/progress/PG.md`
- **How to use:** Configure `AUTH_DOMAIN` and a random `AUTH_SESSION_SECRET` of at least 32 bytes. GET `/auth/nonce?address=...`, sign its `messageToSign`, then POST `{ message, signature }` to `/auth/verify`; the browser stores the session cookie. Call `getCaller(req)` for the authenticated address. `AUTH_DEV_HEADER` defaults false. `SARAL_ENABLED` defaults false, and SARAL still throws `SARAL not configured: awaiting mentor docs` until the docs are implemented.
- **Tested:** Added focused tests for nonce replay/single-use, expiry, wrong chain, mismatched signer, cookie flags, ignored dev header, and fail-closed SARAL; added a mocked standard EIP-1193 chain-switch test. Could not execute them: this checkout has no Node.js/npm runtime or backend package scaffold. MetaMask/BridgeKey extension injection could not be checked in a live browser here; either will use the connector if it exposes a standard EIP-1193 provider.
- **Next:** B1/B2 replace their `getCaller` stub at merge; FE consumes the connector in its frontend path. Add a SARAL-specific verification path only after mentor docs arrive under `docs/sdk/saral/`.

### 2026-09-29 — PG flow aligned to latest B1 backend
- **What:** Aligned PG payment persistence with B1's shared SQLite table, used on-chain deal amounts as 6-decimal base units, added an allowance check before minting, and added payment-claim leases with indexed-event recovery after funding. Added payout lookup, wallet-signature login, an EIP-1193 signer adapter, and an idempotent gas-drip helper. Reviewed `origin/nikil-dev` at `04e58d5`; its indexer already fills `payouts` from `Settled` events.
- **Files:** `backend/src/payments/*`, `backend/src/auth.ts`, `docs/API.md`, `docs/progress/PG.md`
- **How to use:** `createPgIntegration(...)` binds PG routes and `gasDripAddress(address)` to B1's database and viem clients. Mount the returned router at the Express app root. Mount `createAuthRouter(db)` for auth routes; SARAL stays fail-closed pending mentor docs.
- **Tested:** Not run; no tests/build were requested, and this checkout has no backend package scaffold. Static review only.
- **Next:** B1 integrates the PG factory into the shared backend and supplies deployed addresses; implement the SARAL adapter after the mentor docs arrive.

### 2026-09-29 — On-ramp HTTP routes
- **What:** Added a PG-owned Express router for `POST /onramp/:dealId/session` and `POST /onramp/:dealId/confirm`. It delegates deal reads, payment persistence, and chain operations to injected adapters and returns the documented response shapes/errors.
- **Files:** `backend/src/payments/routes.ts`, `docs/progress/PG.md`
- **How to use:** The router is now created through `createPgIntegration(...)`; mount its `paymentsRouter` at the Express app root so it serves on-ramp and payment-history paths.
- **Tested:** Not run; the backend package and Express runtime are not configured in this checkout.
- **Next:** B1 mounts the PG integration in the shared app and supplies deployed configuration.

### 2026-09-29 — SQLite payment-store adapter
- **What:** Implemented the PG store against B1's shared better-sqlite3 schema, including the autoincrement payment ID and text timestamp. A unique deal constraint prevents duplicate sessions; an immediate transaction and expiring claim lease serialize confirmations and allow a later retry to resume from the stored mint hash.
- **Files:** `backend/src/payments/sqlite-store.ts`, `docs/progress/PG.md`
- **How to use:** Create the `payments` table with `schema.sql`, then construct `SqlitePaymentStore` with the shared better-sqlite3 database connection.
- **Tested:** Not run; the backend package and SQLite dependency are not configured in this checkout.
- **Next:** Wire these services to the API and nikil-dev (B1)'s deal/chain clients.

### 2026-09-29 — Mock UPI confirmation orchestration
- **What:** Added an idempotent confirmation service with adapter contracts for an atomic store claim, accepted-deal/amount validation, allowance verification, mint, and `fundFor`. It saves the mint transaction before funding so a funding retry won't mint again, and can reconcile a mined funding event from B1's indexer after restart.
- **Files:** `backend/src/payments/onramp.ts`, `docs/progress/PG.md`
- **How to use:** Call `confirmOnrampPayment(store, chain, dealId)`; the store must atomically claim confirmation and preserve transaction hashes when marking failures. Chain adapter methods must wait for successful receipts.
- **Tested:** Not run; the backend package/router and nikil-dev (B1)'s chain clients are not configured in this checkout.
- **Next:** Wire the session and confirmation services to the API once the shared backend scaffold and nikil-dev (B1)'s chain clients are available.

### 2026-09-29 — Mock UPI session foundation
- **What:** Added the payments table schema and a session service that creates or retrieves the one payment session per deal. It takes the deal's MockUSD base-unit amount, returns a mock UPI payload, and calculates INR at the roadmap's demo rate of ₹84 per MockUSD.
- **Files:** `backend/src/payments/onramp.ts`, `backend/src/payments/schema.sql`, `docs/progress/PG.md`
- **How to use:** Call `createOnrampSession(store, dealId, amountUsdBaseUnits)`; the store must implement atomic `createIfAbsent` using the unique `deal_id` constraint.
- **Tested:** Not run; the backend package/router is not configured in this checkout.
- **Next:** Connect the session service to the API and SQLite store adapter.

### 2026-09-29 — MockUSD mint helper
- **What:** Added a viem helper that mints an exact MockUSD base-unit amount to the ORG wallet, waits for the receipt, and rejects reverted transactions.
- **Files:** `backend/src/payments/mint.ts`, `docs/progress/PG.md`
- **How to use:** Call `mintMockUsd()` with the ORG wallet client, public client, configured token and ORG addresses, and a positive integer base-unit amount. It returns the transaction hash and base-unit amount.
- **Tested:** Not run; the backend package and chain-client setup are not present in this checkout.
- **Next:** Wire the mint helper into confirmation using nikil-dev (B1)'s chain clients and deployed MockUSD address.
