# FE — Frontend (Chandana)

Newest first.

## 2026-09-29 — Wallet sign-in + PG payment interfaces
- **Done:** login is now PG's wallet flow (`docs/API.md` on `geeth-dev`): connect (EIP-6963 MetaMask/BridgeKey, else `window.ethereum`) → switch/add MST Testnet → `GET /auth/nonce` → wallet signs `messageToSign` → `POST /auth/verify` (session cookie). Browsers without a wallet get a "demo wallet on this device" (burner key in localStorage, test only). The wallet address is the account; phone number moved into KYC (still used to find people and on QR codes). Device binding + security PIN kept: after sign-in, a registered-elsewhere account asks for the PIN. Wallet account switch → `POST /auth/logout` + sign out (PG's `bindWalletSession`); network switch off MST → warning banner. Payments use PG's shapes: session `{ …, status, upi: { payee, note }, upiUri }` (QR + UPI deep link from `upiUri`), confirm sends `{ method }` and gets `{ status, mintTx, fundTx }`; the paid screen links the funding tx on `https://testnet.mstscan.com`. Crypto pay uses the signed-in wallet (no separate "link wallet").
- **Also:** `lib/api.ts` sends `X-API-Key` (`NEXT_PUBLIC_API_KEY`) and `credentials: "include"`, defaults to port 5000, reads `{ error: { code, message } }`. Mock backend (`lib/mocks.ts`) keyed by wallet address, same nonce/verify protocol (single-use nonce, signature check), `MOCK_ARBITRATORS` env for arbitrator wallets.
- **Files:** `frontend/lib/{pg-wallet,wallet,api,types,mocks,device-key,format,chain}.ts`, `frontend/components/session.tsx`, `frontend/app/{page,kyc/page,setup-pin/page,pay/new/page,txn/[id]/pay/page,account/**}.tsx`, `frontend/.env.example`
- **Tested:** `tsc`, `eslint`, `next build` pass. Playwright run against the mock backend: demo-wallet sign-in; MetaMask-style injected wallet (add chain → switch → `personal_sign`); KYC + PIN for both; draft → both sign → UPI QR pay → Funded with explorer link; repeat confirm returns the same receipt; bad `method` rejected; network-switch banner shows/clears; account switch signs out; nonce replay rejected; `MOCK_ARBITRATORS` wallet gets the arbitrator role. Not tried against the real backend (not merged/deployed yet).
- **Next:** swap `lib/pg-wallet.ts` for the `@kernel-exploits/shared` export; wire `sendPgContractAction` for contract calls once B1 deploys.

### Requests to others
- **B2:** export PG's `wallet-connector.ts` + `transaction-helper.ts` from `@kernel-exploits/shared` (with a build). FE vendors a copy in `frontend/lib/pg-wallet.ts` until then.
- **PG / B1:** device binding + PIN endpoints FE calls (mock only today): `POST /auth/device/bind`, `/auth/new-device`, `/auth/pin`, `/auth/pin/verify`, `/auth/device`, `GET /users/me`, `GET /users/by-phone/:phone`. Confirm who owns them or whether the PIN stays client-side.
- **B1:** `/kyc/submit` gets `address`, `name`, `phone`, `pan`, `file` in the form; please store `phone` so people can be found by mobile number.

### Interface changes
- FE now consumes PG's auth (`/auth/nonce`, `/auth/verify`, `/auth/logout`) and on-ramp shapes as documented on `geeth-dev`; no change to `docs/API.md` from FE.

## 2026-09-29 — UI skeleton for every screen (mocked)
- **Done:** layout (header nav, wallet button, MST network badge, footer), design tokens in `globals.css` (light/dark), shared UI kit `components/ui.tsx`. Screens: landing `/`, `/login` (MetaMask real if installed, else mock buyer; SARAL button placeholder), `/kyc`, `/dashboard` (buyer/seller/negotiation tabs + stats), `/deals/new`, `/drafts/[draftId]` (SOW workspace: seller points, AI merge, conflicts, weights, approvals), `/deals/[id]` (tracker: escrow balance, on-chain timeline with explorer links, status-driven next-step actions), `/deals/[id]/pay` (mock UPI), `/deals/[id]/dispute`, `/deals/[id]/resolution` (scores, split, accept/escalate), `/deals/[id]/verify`, `/arbitrator` (queue, reasoning, split slider). Buyer/Seller "view as" toggle for demoing with one browser. All routes return 200; unknown deal → 404.
- **Not wired:** every contract call (`proposeDeal`, `acceptDeal`, `markDelivered`, `release`, `raiseDispute`, `acceptResolution`, `escalate`, `claimTimeout`) shows an alert until the ABI lands; browser SOW-hash check and in-browser verify are placeholders.
- **Added endpoint guesses:** `GET /drafts?address=`, `GET /deals/:draftId/sow`, `GET /deals/:id/resolution`.
- **Next:** wait for user's UI feedback, then wire contract calls once ABI is available.

## 2026-09-29 — Hour 0–1: Next.js scaffold with mocked API
- **Done:** `frontend/` — Next.js 16 (App Router) + Tailwind 4 + viem. `lib/chain.ts` (MST `defineChain`, id 91562037), `lib/contracts.ts` (addresses from env, ABI placeholders), `lib/types.ts` (API shapes), `lib/api.ts` (typed client, every endpoint mocked; switch live per endpoint via `NEXT_PUBLIC_LIVE_ENDPOINTS`), `lib/mocks.ts` (in-memory fake backend), `lib/format.ts` (`txUrl`, `addressUrl`, `fmtUsd`, `fmtBps`). `frontend/.env.example`. Typecheck, lint and `next build` pass.
- **Decisions:** TS target raised to ES2020 (bigint for viem). SOW type mirrors B2's `sow/v1` draft (`yashas` branch), not the roadmap's JSON sketch — to be replaced by an import from `shared/` once it's on main. No wagmi yet; plain viem.
- **Next:** Hour 1–4 — MetaMask login, KYC, dashboard, new deal, SOW workspace.
- **Blockers:** `docs/API.md`, `deployments.md`, `AGENTS.md`, `docs/MVP.md` and the contract ABI aren't in the repo, so all API shapes are provisional.

### Requests to others
- **B1 + B2:** publish `docs/API.md`. Endpoints I guessed that aren't in TEAM_ROADMAP: `POST /auth/wallet` (MetaMask login), `GET /users/:address`, `GET /drafts/:id`, `GET /deals?address=` (dashboard list). Please confirm or rename.
- **B1:** push `deployments.md` + `DealEscrow.json` ABI; confirm the on-chain status enum names (I assumed Proposed/Accepted/Funded/Delivered/Disputed/ResolutionProposed/Escalated/Released/Refunded/Split).
- **B2:** merge `shared/` to main so FE can import `hashSow` / types. Note: your `sow/v1` fields (`amount`, `deliveryDeadline`, `reviewWindowSecs`, no `price.token`/`exclusions`) differ from the roadmap's schema sketch — FE follows yours.
- **Whoever has it:** push `docs/TEAM_ROADMAP.md` (FE only has it as a PDF), `docs/MVP.md`, `AGENTS.md`, `contracts/`.
