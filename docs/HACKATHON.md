# Hackathon briefing — MST X Newrro 2k26 (pre-kickoff)

> Moved from the root README. The project README is now `../README.md`.

> MST X Newrro 24-hour hackathon. **IDEATE → BUILD → TEST → DEPLOY → DEMO.**
> Goal: a working prototype with *meaningful* MST Blockchain integration, demoed to the jury within 24 hours.

**Read this whole file before kickoff.** It covers the rules, the sponsors, the chain setup, who owns what, and how we use this repo.

**Doc map:** `README.md` (briefing) → `docs/MVP.md` (design) → `docs/TEAM_ROADMAP.md` (per-person plan) → `docs/API.md` (interfaces) → `docs/STATUS.md` + `docs/progress/` (live progress). AI agents: start with `AGENTS.md`.

---

## Contents

1. [Problem Statement](#1-problem-statement)
2. [Hackathon Rules & Judging](#2-hackathon-rules--judging)
3. [MST Blockchain — What You Need to Know](#3-mst-blockchain--what-you-need-to-know)
4. [Newrro — Co-host](#4-newrro--co-host)
5. [Environment Setup](#5-environment-setup)
6. [Team Roles](#6-team-roles)
7. [Repo Structure & Git Workflow](#7-repo-structure--git-workflow)
8. [Pre-Kickoff Checklist](#8-pre-kickoff-checklist)
9. [Build Timeline](#9-build-timeline)
10. [Demo & Pitch Structure](#10-demo--pitch-structure)
11. [References](#11-references)

---

## 1. Problem Statement

- **Project:** AI-mediated escrow payment gateway on MST (full design in `docs/MVP.md`).
- **Chosen tracks:** Consumer Blockchain & Payments · DeFi & Financial Innovation · AI & Agentic Blockchain.
- **One-line solution:** Buyer and seller agree on an AI-merged, weighted SOW committed on-chain; payment is held in an MST escrow contract; disputes get an AI-proposed, formula-computed split that both must accept, with a human arbitrator as fallback.
- **Why blockchain:** neither party has to trust the other or the platform. The contract holds funds, both parties' agreement to the exact SOW is provable, and every ruling and payout is publicly verifiable.
- **On-chain:** escrowed stablecoins, deal state, SOW/delivery/evidence/reasoning hashes, KYC boolean. **Off-chain:** documents, files, AI reasoning text, KYC documents.

---

## 2. Hackathon Rules & Judging

### Tracks (open-ended; combining is encouraged)

| # | Track |
|---|---|
| 1 | Blockchain & Web3 |
| 2 | DeFi & Financial Innovation |
| 3 | RWA (Real-World Assets) |
| 4 | Consumer Blockchain & Payments |
| 5 | AI & Agentic Blockchain |
| 6 | Robotics & Autonomous Systems |
| 7 | DePIN & IoT |
| 8 | Identity & Verification |
| 9 | Gaming & Digital Economies |
| 10 | Enterprise, Government & Social Impact |

### Key rules

- 24 hours. Build a **functional prototype** and present it to the jury.
- Projects with **meaningful MST Blockchain integration** may receive higher consideration.
- **Adding blockchain without a clear purpose gives no advantage.** Every on-chain component must have a reason.

### Judging criteria

Innovation • Problem-Solution Fit • Technical Implementation • Blockchain Utility • Technology Integration • Functionality • Impact • Scalability • Presentation

**How we win these:**

| Criteria | What wins it |
|---|---|
| Functionality, Problem-Solution Fit, Presentation | A working **end-to-end** demo with real transactions visible in the MST explorer. A smaller system that fully works beats a large half-built one. |
| Blockchain Utility, Technology Integration | A clear answer to "why a chain?" plus native MST tooling (SARAL / WASMify), not just a generic contract. |
| Scalability, Technical Implementation | One clean architecture diagram: on-chain vs off-chain, and why each piece lives where it does. |
| Innovation, Impact | A real user and a real pain point. Numbers if we have them. |

### Valid reasons to put something on-chain

Use at least one of these, and be able to say which one:

- Multiple parties who don't trust each other need a shared source of truth
- A tamper-evident audit trail is required
- Programmable settlement or escrow (money moves on a condition)
- Portable, verifiable credentials or ownership
- Token incentives for decentralized physical infrastructure (DePIN)

---

## 3. MST Blockchain — What You Need to Know

### Overview

- **Public, EVM-compatible Layer 1**, built by **Masterstroke Technosoft** (India). MST = "Masterstroke Secure Technology".
- **EVM-compatible:** Solidity contracts, MetaMask, Remix, Hardhat, Foundry, ethers.js and viem all work as on Ethereum. **Anything you know from Ethereum development carries over.**
- **Native token:** MSTC.
- **Advertised performance** (project claims, not independently verified): 4,000+ TPS, average fee ~0.001 MSTC.
- **Target sectors:** enterprise, fintech, supply chain, digital identity.

### Consensus: Proof of Staked Authority (PoSA)

- Based on **Parlia**, the same consensus model BNB Chain uses. A validator set takes turns producing and validating blocks.
- **For us:** fast blocks and quick finality, so demo transactions confirm almost instantly.
- **Trade-off:** PoSA is more permissioned than Ethereum's Proof of Stake. If a judge asks "how decentralized is it?", answer honestly.
- Full validators stake MSTC and run nodes. Fractional validators can join through the MST portal without running servers. The advertised validator count (70k+) likely includes fractional validators, not block producers.

### MST ecosystem tools (our differentiators)

Using these is most likely what counts as "meaningful MST integration":

| Tool | What it does | Where it fits |
|---|---|---|
| **SARAL** | SDK + web protocol for onboarding with a **mobile number or social login** (Google, Facebook, Twitter). Non-custodial key management using MPC (multi-party computation). Works like OAuth for Web3. | Anything consumer-facing: payments, identity, gaming. Users never see a seed phrase. |
| **WASMify** | Connects Web2 application logic to on-chain verification. Uses zero-knowledge techniques for data privacy and trustless execution. | RWA, compliance, IoT/robotics data. Heavy logic runs off-chain; proofs or results are anchored on-chain. |
| **BridgeKey** | MST's multi-chain wallet. | End-user wallet option. |

> **Action:** ask MST mentors for SARAL / WASMify SDK access and docs at kickoff.

### Network details

| Field | Testnet |
|---|---|
| Network name | MST Testnet |
| Chain ID | `91562037` |
| RPC (HTTP) | `https://testnetrpc.mstblockchain.com` |
| RPC (WebSocket) | `wss://testnetrpc.mstblockchain.com` |
| Currency symbol | MSTC |
| Faucet | **Ask organizers or mentors** |

- **Mainnet explorer:** https://mstscan.com (Blockscout; supports contract verification)
- **Mainnet chain ID:** listed as `4646` on third-party chainlists. **Unverified — confirm with organizers before relying on it.**
- **We build on testnet** unless organizers say otherwise.

### Reusable contracts from Masterstroke

From the official [dex-smart-contracts](https://github.com/Masterstroke-technosoft/dex-smart-contracts) repo:

- **WMST** — wrapped native MST (WETH9-style). Needed wherever native MST must behave as an ERC-20 token.
- **tMUSD** — mock ERC-20 stablecoin with 6 decimals. Useful for payment and DeFi demos.
- A Uniswap-V3-style DEX (RapidexV3). Only relevant if we do DeFi.

---

## 4. Newrro — Co-host

- **Newrro Tech LLP** is a Bengaluru company founded in 2023. It works in **edtech with a robotics focus**: robotics and automation learning kits, courses and programs, plus an AI-driven personalized learning platform.
- Their core team reports experience building autonomous drones and systems for DRDO, the Indian Navy, Karnataka Police and ISRO competitions.
- **What this means for us:** Newrro likely drives the **Robotics & Autonomous Systems** and **DePIN & IoT** tracks, and its judges will value **physical demos**. A project where a device or robot acts, and its data or actions are verified or settled on MST, covers both sponsors.
- **Decision:** we are building **software-only**. The Newrro hardware kit was new to us and too risky for the time available.

---

## 5. Environment Setup

### 5.1 Tools (install before kickoff)

```bash
# Node.js 20+ and a package manager
node -v

# Foundry (primary contract toolchain)
curl -L https://foundry.paradigm.xyz | bash
foundryup
forge --version

# Optional: Hardhat, if you prefer it
npm i -D hardhat
```

### 5.2 Add MST Testnet to MetaMask

MetaMask → Networks → **Add network manually**. Enter the values from the [Network details](#network-details) table.

### 5.3 Environment variables

Create `.env` in the repo root. **Never commit it.**

```bash
MST_RPC_URL=https://testnetrpc.mstblockchain.com
MST_CHAIN_ID=91562037
PRIVATE_KEY=0x...          # TESTNET-ONLY burner wallet. Never a real wallet.
```

### 5.4 Foundry config (`contracts/foundry.toml`)

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.24"

[rpc_endpoints]
mst_testnet = "${MST_RPC_URL}"
```

Deploy:

```bash
cd contracts
source ../.env
forge create src/Example.sol:Example \
  --rpc-url $MST_RPC_URL \
  --private-key $PRIVATE_KEY \
  --broadcast
```

### 5.5 Hardhat network config (if using Hardhat)

```js
// hardhat.config.js
require("dotenv").config();
module.exports = {
  solidity: "0.8.24",
  networks: {
    mstTestnet: {
      url: process.env.MST_RPC_URL,
      chainId: 91562037,
      accounts: [process.env.PRIVATE_KEY],
    },
  },
};
```

### 5.6 Frontend chain definition (viem / wagmi)

```ts
import { defineChain } from "viem";

export const mstTestnet = defineChain({
  id: 91562037,
  name: "MST Testnet",
  nativeCurrency: { name: "MST", symbol: "MSTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: ["https://testnetrpc.mstblockchain.com"],
      webSocket: ["wss://testnetrpc.mstblockchain.com"],
    },
  },
});
```

---

## 6. Team Roles

| Role | Owner | Responsibilities |
|---|---|---|
| **B1 — Backend: chain & data** | _name_ | Contract deployment + verification, viem clients, event indexer, database, KYC, file hashing, dispute/arbitration endpoints, seed data |
| **B2 — Backend: AI agent & SOW** | _name_ | Deal drafts, AI SOW merge, canonical SOW hashing, dispute scoring, split formula (TS + WASM), verify endpoint, WASMify attempt |
| **PG — Payment gateway** | _name_ | MockUSD, mock UPI on-ramp → `fundFor`, settlement tracking, SARAL login + signing, gas drip |
| **FE — Frontend** | _name_ | All screens, wallet connection, deal timeline with explorer links, verify page |

Detailed hour-by-hour steps for each role: `docs/TEAM_ROADMAP.md`.

Everyone tests. Everyone can explain the "why blockchain" answer.

---

## 7. Repo Structure & Git Workflow

### Proposed structure

```
.
├── README.md            # this file
├── AGENTS.md            # shared context for all AI coding agents (CLAUDE.md, GEMINI.md point here)
├── deployments.md       # deployed contract addresses + explorer links
├── contracts/           # Foundry project (src/, script/, test/)
├── backend/             # Express API, chain clients, indexer, AI agent, payments
├── frontend/            # Next.js web app
├── shared/              # hash.ts, split.ts, split.wasm (used by backend AND frontend)
└── docs/                # MVP, roadmap, API, STATUS, progress/ logs, pitch assets
```

### Git rules

- **`main` must always run.** Don't push broken code to it.
- Work on your personal branch (`yashas`, `chandana`, `geeth-dev`, `nikil-dev`). **Never push to `main`**; merge through a PR.
- After each task, add an entry to your role's log in `docs/progress/` and commit it with the code.
- Small, frequent commits with clear messages (`feat: escrow release`, `fix: chain id`).
- Open a PR into `main`. A quick look from one other person is enough during the hackathon; don't block for long reviews.
- **Pull before you start** and before you push: `git pull --rebase origin main`.
- **Never commit** `.env`, private keys, `node_modules/`, `out/` or `cache/`.
- Record every deployed contract address in `deployments.md` immediately after deploying.

---

## 8. Pre-Kickoff Checklist

- [ ] Everyone has cloned this repo and can push to a branch
- [ ] Everyone has Node 20+, Foundry, and MetaMask installed
- [ ] MST Testnet added to MetaMask on every machine
- [ ] Separate **burner testnet wallet** created; testnet MSTC obtained (faucet or organizers)
- [ ] One trivial contract deployed and verified on MST testnet (proves RPC, gas and verification all work)
- [ ] Contracts build locally (`cd contracts && forge build`)
- [ ] Roles assigned in [Section 6](#6-team-roles)
- [ ] SARAL / WASMify docs located, or a list of questions ready for MST mentors
- [ ] Laptops charged, extension cords, hotspot backup

---

## 9. Build Timeline

We build the core in **12 hours**, leaving the remaining time as buffer. Full per-person plan: `docs/TEAM_ROADMAP.md`.

| Hour | Checkpoint |
|---|---|
| 1 | Contracts live + verified on MST; `docs/API.md` frozen |
| 4 | Happy path works via API |
| 6 | Happy path works in the UI |
| 7 | WASMify decision (SDK or browser-verify fallback) |
| 8 | Dispute path works in the UI |
| 8.5 | SARAL decision (SARAL or MetaMask) |
| 10 | **Feature freeze** |
| 10–12 | Seed, full run-throughs, backup video, pitch rehearsal |

---

## 10. Demo & Pitch Structure

1. **Problem** (30s) — who suffers, and how much
2. **Solution** (30s) — one sentence
3. **Why blockchain / why MST** (30s) — the specific reason, plus which MST tools we used
4. **Live demo** (2–3 min) — the real flow, with transactions opened in the explorer
5. **Architecture** (30s) — one diagram, on-chain vs off-chain
6. **Impact & scalability** (30s)
7. **What's next** (15s)

**Always keep a recorded backup of the demo in case the network or Wi-Fi fails.**

### Expected judge questions

- Why not just use a database?
- What happens to user data and privacy?
- How does this scale? What does each transaction cost?
- What's actually on-chain vs off-chain?
- How decentralized is MST (PoSA)? What are the trust assumptions?

---

## 11. References

- MST Blockchain: https://mstblockchain.com
- MST Mainnet Explorer: https://mstscan.com
- Masterstroke DEX contracts (testnet config, WMST, tMUSD): https://github.com/Masterstroke-technosoft/dex-smart-contracts
- Newrro: https://www.newrro.in
- Foundry Book: https://book.getfoundry.sh
- viem: https://viem.sh

---

_Team Kernel Exploits — MST X Newrro Hackathon 2k26_
