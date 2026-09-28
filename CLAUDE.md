# CLAUDE.md — Team Kernel Exploits, MST X Newrro Hackathon 2k26

Context for Claude Code. Read this first every session. Full team briefing: `README.md`.

## What this project is

- 24-hour hackathon. Deliverable: a **working prototype** demoed to a jury.
- Judged on: Innovation, Problem-Solution Fit, Technical Implementation, **Blockchain Utility**, Technology Integration, Functionality, Impact, Scalability, Presentation.
- **MST Blockchain integration must be meaningful.** Never add on-chain logic without a clear reason (multi-party trust, audit trail, programmable settlement, verifiable credentials, DePIN incentives). If a feature works just as well in a database, keep it off-chain.
- Problem statement and chosen solution: see `README.md` Section 1. If it still says TBD, ask the user before making architectural decisions.

## Team

4 members. Roles: Contracts, Integration/Backend, Frontend, Hardware/AI + Pitch. Owners are listed in `README.md` Section 6.

## MST Blockchain (EVM-compatible L1, PoSA consensus)

- Testnet chain ID: `91562037`
- Testnet RPC: `https://testnetrpc.mstblockchain.com` (WebSocket: `wss://testnetrpc.mstblockchain.com`)
- Native token: MSTC (18 decimals)
- Explorer: https://mstscan.com (Blockscout)
- Ecosystem SDKs to prefer where relevant: **SARAL** (MPC keyless login via mobile or social), **WASMify** (ZK-backed Web2 ↔ chain verification).
- Reusable reference contracts: WMST (wrapped MST, WETH9-style) and tMUSD (mock stablecoin, **6 decimals**) in https://github.com/Masterstroke-technosoft/dex-smart-contracts
- Build and deploy on **testnet** unless told otherwise.

## Stack & conventions

- Contracts: **Foundry**, Solidity `0.8.24`, in `contracts/` (`src/`, `test/`, `script/`). Use OpenZeppelin for standard tokens and access control.
- Frontend: `frontend/` — use **viem/wagmi** with the MST testnet chain defined via `defineChain` (see `README.md` Section 5.6).
- Backend: `backend/`. Firmware: `hardware/`. Docs, diagrams, pitch: `docs/`.
- Config comes from `.env` (`MST_RPC_URL`, `MST_CHAIN_ID`, `PRIVATE_KEY`). Never hardcode keys.

## Hard rules

1. **Never commit** `.env`, private keys, mnemonics, `node_modules/`, `out/`, `cache/`, `broadcast/` with keys.
2. **`main` must always run.** Work on branches (`contracts/<feat>`, `frontend/<feat>`, `backend/<feat>`, `hw/<feat>`) and merge via PR.
3. `git pull --rebase origin main` before starting work and before pushing.
4. After every contract deployment, append the address, network, tx hash and explorer link to `deployments.md`.
5. Write a Foundry test for every state-changing contract function before deploying.
6. Contract security baseline: checks-effects-interactions, reentrancy guards on value transfers, explicit access control, events for every state change (the frontend and demo rely on them).
7. Prefer a smaller feature set that works end to end. After hour 18: bug fixes only, no new features.

## Keep `docs/STATUS.md` updated

**After finishing any task**, update `docs/STATUS.md`: what was done, what's in progress, blockers, and any decisions made. The team's claude.ai Project syncs this repo and reads that file to stay in sync with the work done here. Keep entries short, newest first.
