# Progress — FE — Frontend

> Only this role (and its AI agent) edits this file. Newest entry on top.
> Other agents: read it to know what exists, what changed and what we need from you.

## Current state
- **Working on:** wiring live endpoints (every call is mocked by default; switch per endpoint with `NEXT_PUBLIC_LIVE_ENDPOINTS`)
- **Done & usable by others:** `frontend/` — Next.js 16 UPI-style app: two-party agreement flow, device-key signatures, PIN, QR pay/request, checkout, resolution, arbitrator console (all against `app/api/mock`)
- **Blocked by:** —

## Requests to others
<!-- Format: - [ ] @B1/@B2/@PG/@FE: what you need — why (hh:mm) -->
- [ ] @B2: export PG's `wallet-connector.ts` + `transaction-helper.ts` from `@kernel-exploits/shared` (with a build); FE vendors a copy in `frontend/lib/pg-wallet.ts` until then
- [ ] @PG @B1: device binding + PIN endpoints FE calls (mock only today): `POST /auth/device/bind`, `/auth/new-device`, `/auth/pin`, `/auth/pin/verify`, `/auth/device`, `GET /users/me`, `GET /users/by-phone/:phone` — confirm the owner or keep the PIN client-side
- [ ] @B1: `/kyc/submit` gets `address`, `name`, `phone`, `pan`, `file`; please store `phone` so people can be found by mobile number
- [ ] @PG: product is now **Yescro** (tagline "Life is uncertain, payments need not be."); consider renaming the demo UPI payee `tranquebar-demo@upi` in `backend/src/payments/onramp.ts` (e.g. `yescro-demo@upi`) so the QR matches the brand

## Interface changes
<!-- Any change to endpoints, JSON shapes, ABI, shared/ files. Also update docs/API.md. -->
- none

## Log
<!-- Copy this template for each finished task, newest first:
### hh:mm — <task title>
- **What:** what was built or changed
- **Files:** paths touched
- **How to use:** endpoint, function or command others can call now
- **Tested:** how it was verified (curl, test, explorer tx link)
- **Next:** what comes next for this role
-->

### Frontend package renamed to yescro
- **What:** `frontend/package.json` / lockfile package name `frontend` → `yescro`; `frontend/README.md` title. The folder is still `frontend/`, so scripts and paths are unchanged.
- **Files:** `frontend/package.json`, `frontend/package-lock.json`, `frontend/README.md`
- **Tested:** `npm ls` resolves as `yescro@0.1.0`.
- **Next:** —

### Rename to Yescro
- **What:** product name Sakshi → **Yescro** everywhere it's shown (app header, page title, PWA manifest, login, QR scanner, account/help/FAQ/guide, error messages, mock UPI payee) and new tagline **"Life is uncertain, payments need not be."** on the login screen, page description and manifest. Transaction IDs now start with `YSC` instead of `SKS`. Root `README.md` and `docs/KICKSTART.md` updated with the name and tagline.
- **Files:** `frontend/components/Header.tsx` (`APP_NAME`, new `TAGLINE`), `frontend/app/**`, `frontend/lib/{mocks,format}.ts`, `frontend/README.md`, `README.md`, `docs/KICKSTART.md`
- **Tested:** `tsc --noEmit` and `eslint` pass; `git grep -i sakshi` finds nothing.
- **Next:** —

### 2026-09-29 — Merged geeth-dev (B1 + B2 + PG) into chandana; live client aligned with docs/API.md (done by B2's agent at the repo owner's request)
- **What:** merged `origin/geeth-dev` (the whole backend chain). Conflicts: the branch's root `STATUS.md` (team status moved to `docs/STATUS.md`) → FE's decisions added to `docs/STATUS.md`, FE's log entries moved here; `docs/progress/FE.md` → the team template with FE's entries. Also merged FE's own `bf5a42c` (wallet sign-in; it already added `X-API-Key`, `credentials: "include"`, `{ error: { code, message } }` parsing and the official explorer — FE's versions kept). On top, `lib/api.ts` (live path only; mocks unchanged): draft calls use B2's `/drafts/*` (create, terms, sow, merge-sow, conflicts, approve-sow) instead of `/deals/*`, and `createDraft(me, d, counterparty?)` sends `{ initiator, counterparty (the looked-up contact's wallet address), purpose, price, terms }`. `package-lock.json` was out of sync with `package.json` (`npm ci` failed) → regenerated.
- **Files:** `frontend/lib/api.ts`, `frontend/app/pay/new/page.tsx`, `frontend/package-lock.json`, `docs/STATUS.md`, `docs/progress/FE.md`
- **Tested:** `npm ci` OK; `next build` OK (TypeScript + 19 static pages); `eslint .` clean.

### 2026-09-29 — Wallet sign-in + PG payment interfaces
- **Done:** login is now PG's wallet flow (`docs/API.md` on `geeth-dev`): connect (EIP-6963 MetaMask/BridgeKey, else `window.ethereum`) → switch/add MST Testnet → `GET /auth/nonce` → wallet signs `messageToSign` → `POST /auth/verify` (session cookie). Browsers without a wallet get a "demo wallet on this device" (burner key in localStorage, test only). The wallet address is the account; phone number moved into KYC (still used to find people and on QR codes). Device binding + security PIN kept: after sign-in, a registered-elsewhere account asks for the PIN. Wallet account switch → `POST /auth/logout` + sign out (PG's `bindWalletSession`); network switch off MST → warning banner. Payments use PG's shapes: session `{ …, status, upi: { payee, note }, upiUri }` (QR + UPI deep link from `upiUri`), confirm sends `{ method }` and gets `{ status, mintTx, fundTx }`; the paid screen links the funding tx on `https://testnet.mstscan.com`. Crypto pay uses the signed-in wallet (no separate "link wallet").
- **Also:** `lib/api.ts` sends `X-API-Key` (`NEXT_PUBLIC_API_KEY`) and `credentials: "include"`, defaults to port 5000, reads `{ error: { code, message } }`. Mock backend (`lib/mocks.ts`) keyed by wallet address, same nonce/verify protocol (single-use nonce, signature check), `MOCK_ARBITRATORS` env for arbitrator wallets.
- **Files:** `frontend/lib/{pg-wallet,wallet,api,types,mocks,device-key,format,chain}.ts`, `frontend/components/session.tsx`, `frontend/app/{page,kyc/page,setup-pin/page,pay/new/page,txn/[id]/pay/page,account/**}.tsx`, `frontend/.env.example`
- **Tested:** `tsc`, `eslint`, `next build` pass. Playwright run against the mock backend: demo-wallet sign-in; MetaMask-style injected wallet (add chain → switch → `personal_sign`); KYC + PIN for both; draft → both sign → UPI QR pay → Funded with explorer link; repeat confirm returns the same receipt; bad `method` rejected; network-switch banner shows/clears; account switch signs out; nonce replay rejected; `MOCK_ARBITRATORS` wallet gets the arbitrator role. Not tried against the real backend (not merged/deployed yet).
- **Next:** swap `lib/pg-wallet.ts` for the `@kernel-exploits/shared` export; wire `sendPgContractAction` for contract calls once B1 deploys.

#### Requests to others
- **B2:** export PG's `wallet-connector.ts` + `transaction-helper.ts` from `@kernel-exploits/shared` (with a build). FE vendors a copy in `frontend/lib/pg-wallet.ts` until then.
- **PG / B1:** device binding + PIN endpoints FE calls (mock only today): `POST /auth/device/bind`, `/auth/new-device`, `/auth/pin`, `/auth/pin/verify`, `/auth/device`, `GET /users/me`, `GET /users/by-phone/:phone`. Confirm who owns them or whether the PIN stays client-side.
- **B1:** `/kyc/submit` gets `address`, `name`, `phone`, `pan`, `file` in the form; please store `phone` so people can be found by mobile number.

#### Interface changes
- FE now consumes PG's auth (`/auth/nonce`, `/auth/verify`, `/auth/logout`) and on-ramp shapes as documented on `geeth-dev`; no change to `docs/API.md` from FE.

<!-- Entries below were moved here from the branch's root STATUS.md and its first FE.md at the merge (team status lives in docs/STATUS.md). -->

### 2026-09-29 — FE: device security, account, people
- New-device login = OTP + security PIN (seeded PIN 1234); old device removed; 24 h cooling (payments > ₹5,000 blocked); 5 wrong OTP/PIN → 5 min lock
- PIN set once after KYC (`/setup-pin`); app locks with PIN on open and after 2 min in background; PIN needed to sign and release
- `/account`: My QR, security info, How to use (`/account/guide`), FAQs, Help & support (ticket form, not sent anywhere yet)
- Home "People" grid → `/people/[phone]` chat-style history (sent right / received left); Pay/Request from there
- Pay form shows KYC banking name before amount; amount chips and card payments removed; QR upload via file, drag & drop, paste
- Gap: SIM binding needs a native app; PIN reset flow not built

### 2026-09-29 — FE: two-party flow, signatures, QR, checkout, arbitrator
- Fake backend now runs on the Next dev server (`app/api/mock` → `lib/mocks.ts`), shared by every browser/phone; resets on restart
- Test logins (OTP 123456): Priya 9000000001 (buyer), Ravi 9000000002 (seller), Arbitrator 9000000009
- Conflicting terms (e.g. delivery date) block signing until both parties enter the same value — no auto middle ground
- "Agree & sign" signs the agreement hash with a per-device key (registered at login); server + other party verify it
- Pay / Request are separate buttons (no toggle); `/qr` shows a personal QR (Get paid / Pay someone) + `/qr/scan`
- Checkout: UPI QR, UPI ID collect, UPI app (phones), card, linked crypto wallet — all mocked
- Seller can mark delivered; resolution needs both parties to accept; `/arbitrator` console rules on escalated cases
- Device binding enforced across devices via the shared mock (checked every 15 s). **Nothing is deployed**; real enforcement needs PG's `/auth/saral` + `/auth/device`
- **Needs backend agreement:** new endpoints in `frontend/lib/api.ts` (addTerms, proposeConflict, signSow with signature, markDelivered, onrampConfirm method, linkWallet, lookupContact, listCases, arbitrate with note)

### 2026-09-29 — FE: visual polish + history page
- Payment history moved to its own `/history` page (search, All / Paid / Received filters); home keeps pending payments
- Home: green banner with "held safely" total, Pay / Request / History action tiles
- New look across screens: softer cards, filled inputs, icon rows (`components/icons.tsx`), receipt-style transaction details

### 2026-09-29 — FE: sender / receiver toggle
- `/pay/new` has "I'm paying" / "I'm getting paid". A receiver's request goes through the same agreement step; the payer then pays.
- `createDraft` now takes `{ role, counterparty, purpose, price, terms }`; Draft gains `initiator` and `buyerName` (needs B2 agreement)

### 2026-09-29 — FE: UPI-style redesign (branch `chandana`)
- Routes: `/` login (phone + OTP, device-bound) → `/kyc` (first time only) → `/home` (Initiate payment → In progress → Payment history)
- `/pay/new` → `/pay/agreement/[draftId]` (AI-drafted SOW, agree) → `/txn/[id]/pay` (UPI)
- `/txn/[id]` details on tap: transaction ID, initiated on, released on, SOW; release / raise complaint
- `/txn/[id]/complaint` with photo/video proof upload (UI only; file storage TODO) → `/txn/[id]/resolution` (status, split, per-part scores, accept / escalate)
- Removed: dashboard, arbitrator console, verify (hash) page, MST testnet pill, wallet address button, footer
- Installable as a phone app (web manifest + icon)
- **Needs backend agreement:** new endpoints in `frontend/lib/api.ts` — `/auth/otp`, `/auth/saral` with `{phone, otp, deviceId}`, `/auth/device`, `/deals/:id/complaint`, `/deals/:id/release|accept|escalate`, display names on Deal/Draft. All mocked for now.

### 2026-09-29 — FE
- `frontend/` scaffold done: Next.js 16 + Tailwind + viem, MST chain config, typed API client fully mocked (see `docs/progress/FE.md`)
- Waiting on `docs/API.md`, `deployments.md`, ABI

### Pre-kickoff
- README.md team briefing added
- CLAUDE.md added for Claude Code context

### 2026-09-29 — UI skeleton for every screen (mocked)
- **Done:** layout (header nav, wallet button, MST network badge, footer), design tokens in `globals.css` (light/dark), shared UI kit `components/ui.tsx`. Screens: landing `/`, `/login` (MetaMask real if installed, else mock buyer; SARAL button placeholder), `/kyc`, `/dashboard` (buyer/seller/negotiation tabs + stats), `/deals/new`, `/drafts/[draftId]` (SOW workspace: seller points, AI merge, conflicts, weights, approvals), `/deals/[id]` (tracker: escrow balance, on-chain timeline with explorer links, status-driven next-step actions), `/deals/[id]/pay` (mock UPI), `/deals/[id]/dispute`, `/deals/[id]/resolution` (scores, split, accept/escalate), `/deals/[id]/verify`, `/arbitrator` (queue, reasoning, split slider). Buyer/Seller "view as" toggle for demoing with one browser. All routes return 200; unknown deal → 404.
- **Not wired:** every contract call (`proposeDeal`, `acceptDeal`, `markDelivered`, `release`, `raiseDispute`, `acceptResolution`, `escalate`, `claimTimeout`) shows an alert until the ABI lands; browser SOW-hash check and in-browser verify are placeholders.
- **Added endpoint guesses:** `GET /drafts?address=`, `GET /deals/:draftId/sow`, `GET /deals/:id/resolution`.
- **Next:** wait for user's UI feedback, then wire contract calls once ABI is available.

### 2026-09-29 — Hour 0–1: Next.js scaffold with mocked API
- **Done:** `frontend/` — Next.js 16 (App Router) + Tailwind 4 + viem. `lib/chain.ts` (MST `defineChain`, id 91562037), `lib/contracts.ts` (addresses from env, ABI placeholders), `lib/types.ts` (API shapes), `lib/api.ts` (typed client, every endpoint mocked; switch live per endpoint via `NEXT_PUBLIC_LIVE_ENDPOINTS`), `lib/mocks.ts` (in-memory fake backend), `lib/format.ts` (`txUrl`, `addressUrl`, `fmtUsd`, `fmtBps`). `frontend/.env.example`. Typecheck, lint and `next build` pass.
- **Decisions:** TS target raised to ES2020 (bigint for viem). SOW type mirrors B2's `sow/v1` draft (`yashas` branch), not the roadmap's JSON sketch — to be replaced by an import from `shared/` once it's on main. No wagmi yet; plain viem.
- **Next:** Hour 1–4 — MetaMask login, KYC, dashboard, new deal, SOW workspace.
- **Blockers:** `docs/API.md`, `deployments.md`, `AGENTS.md`, `docs/MVP.md` and the contract ABI aren't in the repo, so all API shapes are provisional.

### Requests to others
- **B1 + B2:** publish `docs/API.md`. Endpoints I guessed that aren't in TEAM_ROADMAP: `POST /auth/wallet` (MetaMask login), `GET /users/:address`, `GET /drafts/:id`, `GET /deals?address=` (dashboard list). Please confirm or rename.
- **B1:** push `deployments.md` + `DealEscrow.json` ABI; confirm the on-chain status enum names (I assumed Proposed/Accepted/Funded/Delivered/Disputed/ResolutionProposed/Escalated/Released/Refunded/Split).
- **B2:** merge `shared/` to main so FE can import `hashSow` / types. Note: your `sow/v1` fields (`amount`, `deliveryDeadline`, `reviewWindowSecs`, no `price.token`/`exclusions`) differ from the roadmap's schema sketch — FE follows yours.
- **Whoever has it:** push `docs/TEAM_ROADMAP.md` (FE only has it as a PDF), `docs/MVP.md`, `AGENTS.md`, `contracts/`.
