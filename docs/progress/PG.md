# Progress — PG — Payment gateway

> Only this role (and its AI agent) edits this file. Newest entry on top.
> Other agents: read it to know what exists, what changed and what we need from you.

## Current state
- **Working on:** PG-owned payment, auth, and gas-drip integration for B1's shared Node backend
- **Done & usable by others:** base-unit MockUSD mint helper; idempotent on-ramp services and routes; UPI URI and display-only payment-method persistence; SQLite payments/payouts adapter; B1 viem adapter; nonce-based wallet login with signed session cookie; EIP-1193 wallet and transaction helpers; gas-drip helper/store; SARAL fail-closed stub retained but dropped from the hackathon login flow
- **Blocked by:** B1 must mount the PG routers and invoke the gas-drip hook; B2 must expose the browser wallet modules through `@kernel-exploits/shared`; the FE login and payment flow must consume the wallet login, UPI URI, and payment method; runnable Vitest setup and verifiable deployment records are still needed

## Requests to others
<!-- Format: - [ ] @B1/@B2/@PG/@FE: what you need — why (hh:mm) -->
- [ ] @nikil-dev (B1): the backend is now consolidated under `backend/`; wire `createPgIntegration(...)` with B1's shared `db`, `pub`, and `org`, mount its `paymentsRouter` and `authRouter`, and invoke `gasDripAddress(address)` after KYC approval. Remove B1's duplicate payment routes/table definitions at merge while preserving the indexer's compatible payout columns.
- [ ] @nikil-dev (B1): resolve the `backend/src/auth.ts` collision by retaining PG's API-key middleware and session auth. `getCaller(req)` reads the verified session; B2 should re-export it rather than trusting `x-user-address`.
- [ ] @nikil-dev (B1): make the browser's PG payment routes callable with the verified wallet session and credentialed CORS; do not require a private shared `X-API-Key` in frontend JavaScript.
- [ ] @nikil-dev (B1): add Vitest to the merged backend package and replace the placeholder `test` script. From `backend/`, PG's focused command is `npx vitest run test/auth.test.ts test/wallet-connector.test.ts test/transaction-helper.test.ts test/payments.test.ts`.
- [ ] @nikil-dev (B1): provide real deployment transaction hashes, block numbers, explorer links, and verification status in `deployments.md`; confirm the ORG allowance and `DEPLOY_BLOCK` before end-to-end payment QA.
- [ ] @B2 (yashas): export PG's browser-safe `wallet-connector.ts` and `transaction-helper.ts` through `@kernel-exploits/shared` with the package build so FE does not import browser code from `backend/`.
- [ ] @B2 (yashas): reconcile `docs/API.md` with PG's implemented auth and payment interfaces before merge. The latest `origin/yashas` snapshot (`ae13a74`) omits `/auth/nonce`, `/auth/verify`, and `/auth/logout`, still describes `/auth/saral` as accepting a session proof and `/auth/wallet` as the MetaMask login, omits `upi`/`upiUri` on the on-ramp session, and documents confirmation without PG's required display-only `method` field. Preserve the PG definitions already on `geeth-dev`.
- [ ] @FE (chandana): on `origin/chandana` (reviewed at `149e136`), replace the live phone/OTP/SARAL calls in `frontend/lib/api.ts` and login UI with PG's `GET /auth/nonce?address=...`, `POST /auth/verify { message, signature }`, and `POST /auth/logout`; send requests with credentials so the HttpOnly session cookie works. `POST /auth/saral` is fail-closed and does not accept OTP/device fields. Correct `onrampConfirm`'s live return type to `{ status, mintTx, fundTx }` and align `OnrampSession` with the documented `upi` and `upiUri` fields. Replace HTTP mutation calls for `proposeDeal`, `acceptDeal`, `markDelivered`, `release`, `raiseDispute`, `acceptResolution`, and `escalate` with wallet-signed actions through B2's shared exports; upload delivery/evidence to B1 first and sign using the returned hash. Explain that `crypto` confirmation is display-only metadata on the Mock UPI/ORG mint-and-fund flow, not a user-wallet transfer. Keep mocks behind the existing switch. These are FE-owned changes; PG's browser modules are not importable from `backend/` in the browser bundle.
- [ ] @B2: confirm whether any PG endpoint consumes `hashSow` / `hashJson`; current PG flows do not hash SOW or reasoning data.

## Interface changes
<!-- Any change to endpoints, JSON shapes, ABI, shared/ files. Also update docs/API.md. -->
- FE handoff: `discoverWallets()` + `createInjectedWalletConnector(provider)` in `backend/src/auth/wallet-connector.ts`; use EIP-6963 first, MetaMask primary, BridgeKey only when it announces EIP-1193, then `window.ethereum` fallback. Bind `accountsChanged` with `bindWalletSession(connector, { onLoginRequired })` to clear `/auth/logout` and prompt a fresh SIWE login; `chainChanged` should disable actions off MST. `getTestGasStatus()` provides the low-gas message and faucet link. After B2 exports the browser modules through `@kernel-exploits/shared`, FE uses `sendPgContractAction()` for `proposeDeal`, `acceptDeal`, `markDelivered`, `release`, `raiseDispute`, `acceptResolution`, `escalate`, and `fund`; it waits for a successful receipt and returns `{ txHash, explorerUrl }`.
- `docs/API.md`: added the wallet discovery, session event, low-gas UX, contract action helper, receipt, explorer-link, `upiUri`, and payment-method handoff. Auth endpoints and payloads did not change.
- `/onramp/:dealId/session` now includes `upiUri`; `/onramp/:dealId/confirm` accepts a required display-only `method` and persists it for payment history. `Payment.method` is nullable until confirmation. `sendPgContractAction` includes `markDelivered`.
- Browser wallet/transaction modules remain in PG-owned `backend/src/auth/` until B2 exports them through the B2-owned `shared/` package; `docs/API.md` now documents that handoff rather than telling FE to import backend code.
- SARAL is dropped from the hackathon path but its connector remains fail-closed; leave `SARAL_ENABLED=false`.
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

### 2026-09-29 — Chandana FE integration review
- **What:** Reviewed the latest available `origin/chandana` snapshot (`149e136`) against PG's documented auth, payment, and wallet-transaction interfaces. Found the FE live auth still targets phone/OTP and undocumented SARAL device endpoints; the on-ramp confirmation type expects a `Deal` instead of PG's response; delivery/release/resolution actions still mutate through HTTP; and the crypto option presents PG's display-only confirmation as wallet payment. Recorded exact FE and B2 handoffs without editing their owned paths.
- **Files:** `docs/progress/PG.md`
- **How to use:** FE should use the requests above; after B2 exports the browser-safe wallet modules from `@kernel-exploits/shared`, FE can call `sendPgContractAction()` for user-signed escrow actions. Keep the mock API path available for UI demos.
- **Tested:** Documentation/source review only; no tests or application code changed.
- **Next:** FE applies its integration fixes on its branch; B2 provides shared exports. PG can then help resolve any interface mismatch in PG-owned files.

### 2026-09-29 — Yashas B2 branch integration review
- **What:** Reviewed `origin/yashas` at `ae13a74`. B2 now has a built ESM `@kernel-exploits/shared` with browser-safe SOW/hash, split, and verification exports, plus Express routers that accept injected PG `getCaller` and a shared SQLite store. The current package index does not export PG's wallet connector or transaction helper. B2's latest `docs/API.md` also omits the implemented PG SIWE and UPI request/response fields, so recorded a docs reconciliation request. PG's `getCaller(req)` and `requireApiKey` signatures are compatible with B2's documented router integration; direct wallet signing requires no separate device-key registry.
- **Files:** `docs/progress/PG.md`
- **How to use:** B1 injects PG's `getCaller` into B2's routers and shares the SQLite connection with `SowStore`; FE imports B2's SOW/hash/split/verify exports from `@kernel-exploits/shared`. Keep PG's wallet modules in the shared-package handoff request until they are actually exported.
- **Tested:** Branch and interface source review only; no code or tests changed.
- **Next:** B2 reconciles the shared API documentation and confirms the wallet-module export plan; B1 mounts the routers with PG auth.

### 2026-09-29 — PG payment UX and merge-plan alignment
- **What:** Added the mock UPI deep link to on-ramp sessions, accepted and stored the confirmation method as display-only payment metadata, included `markDelivered` in the transaction helper, and aligned the API/progress handoff with the team merge plan. Recorded B1, B2, and FE integration requests without editing their owned paths. SARAL stays fail-closed and out of the hackathon login flow.
- **Files:** `backend/src/payments/onramp.ts`, `backend/src/payments/routes.ts`, `backend/src/payments/sqlite-store.ts`, `backend/src/payments/schema.sql`, `backend/src/auth/transaction-helper.ts`, `docs/API.md`, `docs/progress/PG.md`
- **How to use:** Session response contains `upiUri` using the demo payee, note, and INR amount. POST `/onramp/:dealId/confirm` with `{ method: "upi_qr" | "upi_id" | "upi_app" | "crypto" }`; the method is returned in payment history as display-only data. FE's action list now includes `markDelivered`.
- **Tested:** `git diff --check` passed. Tests and typecheck were not run; this checkout has no Node/npm executable or backend package manifest.
- **Next:** B1 mounts PG routers and gas drip; B2 exports browser helpers from `shared/`; FE switches to wallet login and consumes the documented payment fields; then run the focused Vitest command once merged package dependencies are available.

### 2026-09-29 — PG wallet connection and transaction handoff
- **What:** Added EIP-6963 discovery for MetaMask and an EIP-1193 BridgeKey provider, legacy injected fallback, MST chain switch/add configuration, user rejection messaging, account-change logout/re-login binding, off-chain action blocking, low-test-gas UX status, and a viem contract-call helper for the requested escrow actions. SARAL remains fail-closed. Documented the FE interface.
- **Files:** `backend/src/auth/wallet-connector.ts`, `backend/src/auth/transaction-helper.ts`, `backend/test/wallet-connector.test.ts`, `backend/test/transaction-helper.test.ts`, `docs/API.md`, `docs/progress/PG.md`
- **How to use:** See the “PG wallet and transaction module” section in `docs/API.md`. FE calls the connector's `connect()`, logs in using existing `/auth/nonce` and `/auth/verify`, binds account changes to session logout/re-login, checks test gas after login, and calls `sendPgContractAction()` for the listed escrow methods.
- **Tested:** Added mocked tests for MetaMask/BridgeKey announcements, 4902 chain add parameters, 4001 rejection, account-change logout and relogin, chain gating, transaction receipt/link and reverted receipt. Not executed: Node.js/npm and runnable backend test setup are unavailable in this checkout. BridgeKey live behavior: not tried; no browser or wallet UI is available here (mocked EIP-1193 announcement test only).
- **Next:** FE consumes the documented PG module; B1 mounts the PG auth/payment routers and calls the gas drip after KYC. Run tests/typecheck when the backend runtime/test setup is available, then verify BridgeKey in a browser with the wallet installed.

### 2026-09-29 — PG test coverage and B1 integration check
- **What:** Added unit cases for five repeated payment confirmations, retrying failed funding without a second mint, rejecting deals that are not `Accepted`, gas-drip threshold behavior, one-time send, and terminal failed attempts. Checked the latest local `origin/nikil-dev` snapshot: it is Node/Express/TypeScript, so the earlier Flask/Node mismatch is not present there. The remaining integration mismatch is directory layout: B1's app/package are under `backend/backend/`, but this branch's PG source/tests are under `backend/`.
- **Files:** `backend/test/payments.test.ts`, `docs/progress/PG.md`
- **How to use:** Once B1 confirms the canonical directory and test runner, run the auth, wallet connector, and payments Vitest files from the backend package. B1 still needs to mount `authRouter` and `paymentsRouter` and invoke `gasDripAddress(address)` after successful KYC approval.
- **Tested:** `git diff --check` passed. Focused tests/build were not run: this checkout has no Node.js/npm executable, no local backend package manifest, and no installed test dependencies. No end-to-end QA or backup demo video is possible until B1 supplies deployed addresses and FE provides a runnable UI.
- **Next:** B1 confirms backend path and test setup; then run build/tests and complete the live payment and settlement QA. SARAL remains fail-closed until mentor docs arrive.

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
