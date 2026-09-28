# KICKSTART — Context brief for AI agents

> Paste this into any AI agent at the start of a session, or point it to `docs/KICKSTART.md`.
> For the full rules, read `AGENTS.md`.

## What we're building

An **AI-mediated escrow payment gateway on MST Blockchain**, built by Team Kernel Exploits (4 people) at the MST X Newrro Hackathon 2k26 in a 12-hour build. Software only (we dropped the Newrro hardware kit). Project name: TBD (top candidate: *Sakshi*, "witness").

**The flow:**
1. The user logs in (SARAL or MetaMask) and completes mock KYC.
2. The buyer creates a deal and states their constraints; the seller adds their own points.
3. The AI merges both into a **weighted SOW**, with deliverables whose `weightBps` sum to 10000.
4. Both parties commit the **same SOW hash** on-chain: the buyer calls `proposeDeal`, the seller calls `acceptDeal`.
5. The buyer pays through a mock UPI screen. The ORG mints MockUSD and calls `fundFor`, which locks the funds **in the contract, not the ORG's wallet**.
6. The seller delivers and calls `markDelivered`.
7. Outcome:
   - The buyer calls `release`, or the seller calls `claimTimeout` if the buyer stays silent past the review window.
   - Or the buyer calls `raiseDispute`: the AI scores each deliverable (integer 0–100), a fixed formula computes the split, the agent calls `proposeResolution`, and then either both parties accept (`acceptResolution`) or one escalates and the human arbitrator decides (`arbitrate`).

**Split formula:** `buyerBps = Σ floor(weightBps × (100 − fulfilledPct) / 100)`.

**Core principle:** the AI agent can only *propose*; it can never move money. Funds move only by buyer release, mutual acceptance, timeout, or arbitrator ruling. The contract enforces this.

## What already exists in the repo

| Path | Status |
|---|---|
| `contracts/src/DealEscrow.sol` | ✅ Written, compiled, flow-tested locally (happy path, dispute, escalation, timeout, SOW mismatch, non-agent blocked). **Don't modify without B1's approval.** |
| `contracts/src/MockUSD.sol` | ✅ 6-decimal ERC-20, owner can mint (the on-ramp) |
| `contracts/script/Deploy.s.sol`, `foundry.toml`, `remappings.txt` | ✅ Ready. Run `forge install` first. |
| `docs/MVP.md` | ✅ Full design: flow, architecture, state machine, contract API, AI agent design, MST integration |
| `docs/TEAM_ROADMAP.md` | ✅ Hour-by-hour plan for each role, plus how each role uses MST |
| `docs/API.md` | 📝 Draft endpoints and JSON shapes. B1 and B2 freeze it at hour 1. |
| `docs/MST_Services.pdf` | ✅ The 10 MST services: priority, owner, fallback |
| `AGENTS.md`, `docs/STATUS.md`, `docs/progress/*` | ✅ Shared agent rules, team checkpoints, per-role logs |
| `.env.example`, `.gitignore`, `deployments.md` | ✅ Templates. **Nothing is deployed yet.** |
| `shared/src/sow.ts`, `shared/src/hash.ts` | ✅ B2 step 1 done (branch `yashas`, commit `a3f6392`): SOW zod schema `sow/v1` + `hashSow()`; 9 tests pass |
| `backend/`, `frontend/` | ⬜ Not started |

## Stack

- **Contracts:** Foundry, Solidity 0.8.24, OpenZeppelin v5
- **Backend:** Node, Express, TypeScript, SQLite, viem
- **Frontend:** Next.js, Tailwind, viem
- **Shared code** (`shared/`): `src/sow.ts` (SOW schema), `src/hash.ts` (`hashSow`: RFC 8785 canonical JSON → keccak256), and later `split.ts` / `split.wasm` (the split formula)
- **AI:** an LLM API called only from the backend, with tool-forced JSON output, temperature 0, and a versioned prompt

## MST facts

- EVM-compatible Layer 1 using Proof of Staked Authority. Testnet chain ID `91562037`, RPC `https://testnetrpc.mstblockchain.com` (WebSocket `wss://…`), gas token MSTC, ~3-second blocks.
- **MST services we use:**
  - **Core:** the testnet, our contracts, MSTC gas, the RPC/WebSocket endpoints, the explorer, and the stablecoin (MockUSD, or tMUSD if we get access)
  - **Should:** SARAL (MPC keyless login)
  - **Stretch:** WASMify (verifiable execution of the split formula)
  - **Optional:** BridgeKey
  - **Pitch only:** the post-quantum security layer
- **SARAL and WASMify have no public docs.** Use only what's in `docs/sdk/`. Never invent their APIs.

## Roles

| Code | Role | Starts with (see `TEAM_ROADMAP.md`) |
|---|---|---|
| **B1** | Backend: chain & data | Deploy and verify contracts → fill in `deployments.md` → viem clients + event indexer |
| **B2** | Backend: AI agent & SOW | SOW schema + `shared/hash.ts` → SOW draft and merge endpoints → dispute scorer + formula |
| **PG** | Payment gateway | Mint pipeline → idempotent mock UPI → `fundFor` → SARAL + gas drip |
| **FE** | Frontend | Next.js scaffold with mocked API → onboarding + SOW screens → deal timeline with explorer links |

**Checkpoints:**

| Hour | Checkpoint |
|---|---|
| 1 | Contracts deployed; API frozen |
| 4 | Happy path works via API |
| 6 | Happy path works in the UI |
| 7 | WASMify: go or no-go |
| 8 | Dispute path works in the UI |
| 8.5 | SARAL: go or no-go |
| 10 | **Feature freeze** |

## Rules that matter most

1. Never touch or print keys, `.env` or API keys.
2. Work only in your role's paths. Ask other roles for changes through "Requests to others" in your progress log.
3. If an interface changes, update `docs/API.md` in the same commit.
4. The split is computed only by `shared/split.*`. The LLM never outputs a split.
5. After each task, add an entry to the top of your `docs/progress/<role>.md` and commit it together with the code.

## First actions for any agent

1. Work on your own branch only. Don't sync with main or read others' logs during the build; everyone merges into main once at the end. Build strictly against docs/API.md so branches integrate cleanly. (never push to `main`)
2. Ask your user which role they are (B1, B2, PG or FE).
3. Read `AGENTS.md` → `docs/API.md` → your section of `docs/TEAM_ROADMAP.md` → your own `docs/progress/<role>.md`.
4. Continue from your next unfinished step. After each task, update your own progress log.

## Open questions (waiting on MST mentors)

- SARAL SDK access, and whether it supports gasless transactions
- WASMify SDK access
- A testnet faucet or MSTC for 5 wallets
- The testnet explorer URL
- Minting access to tMUSD
