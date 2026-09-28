# AGENTS.md — Shared context for ALL AI coding agents

> Read this file completely at the start of every session, whatever tool you are
> (Claude Code, Codex, Cursor, Copilot, Gemini, …). It is the single source of truth.
> Tool-specific files (CLAUDE.md, GEMINI.md, .github/copilot-instructions.md,
> .cursor/rules/) only point here.

## 1. Project

**AI-mediated escrow payment gateway on MST Blockchain.** Team Kernel Exploits, MST X Newrro Hackathon 2k26, 12-hour build.

The buyer and seller each give requirements → an AI agent merges them into a weighted SOW → both commit the SOW hash on-chain → the buyer pays via a mock UPI on-ramp → stablecoins are locked in the `DealEscrow` contract → the buyer releases, or disputes → the AI proposes a split (it can't move funds) → both accept, or a human arbitrator rules.

New session? Read `docs/KICKSTART.md` first.

Required reading, in order: `docs/MVP.md` (design) → `docs/TEAM_ROADMAP.md` (who does what, hour by hour) → `docs/API.md` (interfaces) → your own log in `docs/progress/`. Don't read other roles' logs during the build (see §5).

## 2. Team & ownership

| Code | Role | Owns (paths) | Progress log |
|---|---|---|---|
| B1 | Backend — chain & data | `contracts/`, `backend/src/chain*`, `backend/src/indexer*`, `backend/src/db*`, `scripts/` | `docs/progress/B1.md` |
| B2 | Backend — AI agent & SOW | `backend/src/agent*`, `backend/src/sow*`, `shared/` | `docs/progress/B2.md` |
| PG | Payment gateway | `backend/src/payments*`, `backend/src/auth*`, SARAL adapter | `docs/progress/PG.md` |
| FE | Frontend | `frontend/` | `docs/progress/FE.md` |

**Branches are personal** (`yashas`, `chandana`, `geeth-dev`, `nikil-dev`). Never push to `main`; merge into `main` only through a PR. **Ask your user which role they are** (B1, B2, PG or FE) at the start of the session. Work only in your role's paths. If you need a change in another role's area, write it under "Requests to others" in your log instead of editing their files.

## 3. MST Blockchain facts

- EVM-compatible L1 with Proof of Staked Authority consensus. Standard Solidity/viem/Foundry tooling works unchanged.
- Testnet chain ID `91562037`, RPC `https://testnetrpc.mstblockchain.com`, WebSocket `wss://testnetrpc.mstblockchain.com`, gas token MSTC (18 decimals), ~3 s blocks.
- Stablecoin: `MockUSD` (6 decimals). Could be swapped for MST's tMUSD later.
- MST SDKs: **SARAL** (MPC keyless login) and **WASMify** (ZK-backed verifiable execution). **Neither is publicly documented. Never invent their APIs.** Use only what is in `docs/sdk/` or the mentor-provided docs. If those are missing, stop and ask your user.
- Deployed addresses: **only** from `deployments.md`. Never hardcode an address from memory.
- Official MST docs are in docs/sdk/ — read them before using any MST-specific tool.

## 4. Non-negotiable rules

1. **Never** read, print, commit or paste private keys, `.env` contents or API keys. The keys live only in `.env` (gitignored).
2. `contracts/src/DealEscrow.sol` is flow-tested. Any change needs B1's approval and a re-run of every flow. Don't refactor it for style.
3. Interfaces are frozen in `docs/API.md`. If you change a request or response shape, update `docs/API.md` **in the same commit** and flag it in your progress log under "Interface changes."
4. The dispute split is computed **only** by `shared/split.ts` / `split.wasm`: `buyerBps = Σ floor(weightBps × (100 − fulfilledPct) / 100)`, with integer scores from 0 to 100. The LLM never outputs a split.
5. The SOW format is defined **only** in `shared/src/sow.ts` (zod schema, `sow/v1`). SOW hashing uses **only** `hashSow()` from `shared/src/hash.ts` (addresses lowercased → RFC 8785 canonical JSON → keccak256), identical in backend and browser. Never hash a SOW any other way.
6. No personal data on-chain: only hashes, addresses, amounts and the KYC boolean.
7. `main` must always run. Work on your personal branch; never push to `main` directly. Merge through a PR.
8. After hour 10 (feature freeze): bug fixes only.

## 5. Session protocol (every agent, every session)

**At start:**
1. Work on your own branch only. Don't sync with main or read others' logs during the build; everyone merges into main once at the end. Build strictly against docs/API.md so branches integrate cleanly.

**After finishing each task (before committing):**
1. Add an entry at the **top** of your role's log in `docs/progress/` using the template in that file.
2. If you changed deployed contracts, an interface, or a checkpoint status, update `docs/STATUS.md` too.
3. Commit the code and the log update **together**: `git commit -m "<role>: <what> (+progress)"`.

**Never edit another role's progress log.** Communicate only through "Requests to others."
