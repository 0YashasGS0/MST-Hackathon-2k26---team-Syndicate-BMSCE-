# FE — Frontend (Chandana)

Newest first.

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
