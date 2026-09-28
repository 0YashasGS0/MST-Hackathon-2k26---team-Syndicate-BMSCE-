# MVP — AI-Mediated Escrow Payment Gateway on MST

> Team Kernel Exploits · MST X Newrro Hackathon 2k26
> Contracts: `contracts/src/DealEscrow.sol`, `contracts/src/MockUSD.sol` (compiled and flow-tested locally: happy path, dispute, escalation, timeout, SOW mismatch)

## 1. One-liner

Buyer and seller agree on a Statement of Work (SOW) that an AI agent merges from both sides. The buyer pays in fiat, which is converted to stablecoins and **locked in an MST smart contract**. Funds release on satisfaction. On a dispute, the AI agent proposes a proportional split based on the SOW, and a human arbitrator steps in only if either side rejects it.

**Tracks:** Consumer Payments + DeFi + AI & Agentic Blockchain.

**Why blockchain (the judge answer):** buyer and seller don't trust each other, and neither should have to trust the platform to hold money or rule fairly. The contract holds the funds, both parties' agreement to the *exact* SOW is recorded on-chain, and every step (delivery, complaint, AI ruling, payout) is a tamper-evident public record. The platform **cannot** take the funds or pay anyone without following the rules in the contract.

---

## 2. Changes to the notebook flow (important)

The notebook flow is solid. Four changes turn it from "a website with a crypto wallet" into real blockchain utility:

| Notebook step | Problem | Fix |
|---|---|---|
| "ORG converts & stores stablecoins in **the wallet**" | If the ORG's wallet holds the money, it's a custodial escrow. That's just a bank with extra steps, and judges will say "why not a database?" | ORG only does fiat → stablecoin. The stablecoins go straight into `DealEscrow` via `fundFor()`. The ORG can never withdraw them. |
| "Agent resolves & divides the cost" | An AI with the power to move money is a single point of failure (prompt injection, hallucination, compromised key). | The agent can only **propose** a split (`proposeResolution`). Money moves only when **both parties accept**, or the **human arbitrator** rules after escalation. This is enforced in the contract. |
| "Constraints mutually agreed beforehand" | Agreement happens off-chain, so later "I never agreed to that" can't be settled. | The final SOW is hashed (keccak256). The buyer calls `proposeDeal(sowHash)` and the seller calls `acceptDeal(sowHash)` with the **same hash**. That's on-chain proof that both agreed to the identical document. |
| "Divide cost proportionally" | Vague, and an LLM choosing a percentage is arbitrary. | The SOW has **deliverables with weights** (% of price). The agent scores how far each deliverable was fulfilled, and a **deterministic formula** computes the split. See §7. |

Also add **timeouts**:
- If the buyer goes silent after delivery, the seller can claim after the review window.
- If the seller misses the deadline, the buyer can reclaim the money.

Without these, either side can freeze the other's money indefinitely.

---

## 3. Final user flow

**Setup**
1. **Login** with SARAL (mobile number or Google). This creates an MPC wallet whose key share is bound to the device, which covers the notebook's "authenticated device" requirement.
2. **KYC:** a mock document upload, then admin approval. On-chain, only `setKyc(address, true)` is recorded. **No personal data ever goes on-chain.**

**Agreement (off-chain negotiation, on-chain commitment)**

3. The buyer selects the payee (the seller's registered handle or wallet).
4. The buyer adds the transaction purpose, price and their constraints.
5. The seller gets the request and adds their own points (scope, exclusions, timeline).
6. The **AI agent merges** both inputs into a structured SOW (§7.1).
7. Both parties review the SOW. If either edits it, the agent re-merges; loop until both approve.
8. On-chain: the buyer calls `proposeDeal(seller, amount, sowHash, deliverBy, reviewPeriod)`, then the seller calls `acceptDeal(id, sowHash)`.

**Payment**

9. The buyer pays fiat through the **mock on-ramp** (a fake UPI screen).
10. The ORG backend mints stablecoins (MockUSD) and calls `fundFor(id)`, which locks them in escrow. Status becomes `Funded`.

**Completion**

11. The seller delivers and uploads proof, which triggers `markDelivered(id, deliveryHash)` and starts the review window.
12. There are three possible outcomes:
    - **Satisfied:** the buyer calls `release(id)` and the seller is paid.
    - **Silent:** after the review window, the seller calls `claimTimeout(id)` and is paid.
    - **Not satisfied:** the buyer calls `raiseDispute(id, evidenceHash)` with evidence files.

**Dispute**

13. The AI agent evaluates the SOW against the delivery and evidence. It scores each deliverable and computes the split, then calls `proposeResolution(id, buyerBps, reasoningHash)`.
14. **Both accept:** each party calls `acceptResolution(id)` and the split is paid out automatically.
15. **Either rejects:** they call `escalate(id)`. The human arbitrator reviews and calls `arbitrate(id, buyerBps, reasoningHash)`, and that decision is final.

---

## 4. Architecture

```
┌─────────────────────────── Frontend (Next.js + viem) ───────────────────────────┐
│ Login(SARAL) · KYC · New deal · SOW negotiate/sign · Pay · Tracker · Dispute     │
│ Arbitrator console · every on-chain step links to mstscan                        │
└───────────────┬───────────────────────────────────────────────┬─────────────────┘
                │ REST                                          │ wallet txs (SARAL / MetaMask)
┌───────────────▼──────────────── Backend (Node/Express) ───────┴─────────────────┐
│ Deal & SOW store (SQLite)   · Evidence/file store (disk or IPFS)                │
│ AI Agent service  ── SOW merge + dispute scoring (LLM) ──► split formula (WASM) │
│ Mock on-ramp  ── fake UPI ──► mint MockUSD ──► fundFor()   (ORG wallet)         │
│ KYC admin ──► setKyc()      · Gas drip for new wallets     · Event indexer      │
└───────────────┬────────────────────────────────────────────────────────────────┘
                │ JSON-RPC (testnetrpc.mstblockchain.com, chain 91562037)
┌───────────────▼──────────────────────── MST Testnet ───────────────────────────┐
│ DealEscrow.sol  (funds, SOW hash, state machine, roles: owner/agent/arbitrator) │
│ MockUSD.sol     (6-dec stablecoin; swap for tMUSD if organizers provide it)     │
│ WASMify         (verifiable execution of the split computation — if SDK access) │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### What is on-chain vs off-chain

| Data | Where | Why |
|---|---|---|
| Escrowed funds | **On-chain** (contract) | Nobody, including the ORG, can take them |
| Deal state and transitions | **On-chain** | Public, tamper-evident timeline |
| SOW hash, delivery hash, evidence hash, reasoning hash | **On-chain** | Proves what was agreed and submitted; the documents can't be secretly changed later |
| KYC flag (bool per address) | **On-chain** | Contract only allows verified parties |
| SOW text, files, evidence, KYC documents, chat | **Off-chain** | Privacy, size, and cost |
| AI reasoning full text | **Off-chain** (hash on-chain) | Auditable: anyone can re-hash and compare |

---

## 5. Contract state machine

```
Proposed ──accept──► Accepted ──fund/fundFor──► Funded ──markDelivered──► Delivered
   │                    │                         │   │                      │   │
 cancel               cancel          deadline passed release          review window release
   ▼                    ▼            (claimTimeout)   │               passed      │
Cancelled           Cancelled              ▼          │           (claimTimeout)  │
                                        Refunded      ▼                 ▼          ▼
                                                   Released          Released   Released
Funded / Delivered ──raiseDispute──► Disputed ──agent──► ResolutionProposed
      ResolutionProposed ──both accept──► Resolved (split paid)
      Disputed / ResolutionProposed ──escalate──► Escalated ──arbitrate──► Resolved
```

---

## 6. Smart contract API (`DealEscrow.sol`)

| Function | Caller | Effect |
|---|---|---|
| `setKyc(user, bool)` | Owner (ORG) | Marks an address as KYC-verified |
| `setRoles(agent, arbitrator)` | Owner | Rotates the agent and arbitrator keys |
| `proposeDeal(seller, amount, sowHash, deliverBy, reviewPeriod)` | Buyer | Creates the deal; both parties must be KYC'd |
| `acceptDeal(id, sowHash)` | Seller | Must match the buyer's SOW hash |
| `cancelDeal(id)` | Either party | Only before funding |
| `fund(id)` | Buyer | Pays from the buyer's own stablecoin balance |
| `fundFor(id)` | Owner (on-ramp) | ORG funds after fiat is received; refunds still go to the buyer |
| `markDelivered(id, deliveryHash)` | Seller | Starts the review window |
| `release(id)` | Buyer | Full amount to seller |
| `claimTimeout(id)` | Anyone | Pays the seller if the review window passed, or refunds the buyer if the deadline passed |
| `raiseDispute(id, evidenceHash)` | Either party | Only while funded or within the review window |
| `proposeResolution(id, buyerBps, reasoningHash)` | Agent | Proposal only; resets both acceptances |
| `acceptResolution(id)` | Each party | Pays out when both have accepted |
| `escalate(id)` | Either party | Sends the dispute to the human arbitrator |
| `arbitrate(id, buyerBps, reasoningHash)` | Arbitrator | Final ruling and payout |
| `getDeal(id)` | View | Full deal struct for the frontend |

`buyerBps` is the buyer's refund share in basis points: 3000 means 30% goes back to the buyer and 70% to the seller.

**Security baseline:**
- `SafeERC20` for token transfers
- `ReentrancyGuard` against re-entrancy
- Checks-effects-interactions (state updated before tokens move)
- Role checks on every privileged function
- An event for every transition (the frontend timeline and indexer read these)

---

## 7. AI agent design

### 7.1 SOW merge

**Input:** the buyer's purpose and constraints, plus the seller's points.
**Output:** a structured SOW JSON. **The authoritative format is `shared/src/sow.ts` (`sow/v1`);** the example below shows the idea, not the exact fields:

```json
{
  "title": "Landing page for bakery",
  "buyer": "0xBuyer", "seller": "0xSeller",
  "price": { "amount": "100.00", "token": "mUSD" },
  "deliverables": [
    { "id": "D1", "description": "Responsive homepage", "acceptanceCriteria": ["Works on mobile", "Lighthouse > 80"], "weightBps": 5000 },
    { "id": "D2", "description": "Menu page with 20 items", "acceptanceCriteria": ["All 20 items with prices"], "weightBps": 3000 },
    { "id": "D3", "description": "Contact form", "acceptanceCriteria": ["Sends email to owner"], "weightBps": 2000 }
  ],
  "deadline": "2026-10-05T18:00:00Z",
  "reviewPeriodHours": 48,
  "exclusions": ["Hosting costs", "Logo design"],
  "revisions": 2
}
```

**Rules for the merge prompt:**
- `weightBps` values must sum to 10000.
- Every deliverable needs measurable acceptance criteria.
- The agent flags conflicts between buyer and seller points and never silently resolves them. Conflicts go back to the parties.

**SOW hash** = `keccak256(canonicalJSON(sow))`. Use RFC 8785 canonicalization (the `canonicalize` npm package) on both frontend and backend, so both compute the identical hash.

### 7.2 Dispute resolution (LLM scores, formula decides)

1. **LLM step.** The agent receives the SOW, delivery proof and evidence, and outputs a fulfilment score per deliverable as an **integer percentage (0–100)**. Integers keep the formula identical across backend, browser and WASM:

```json
{ "scores": [
  { "id": "D1", "fulfilledPct": 100, "rationale": "Mobile layout works; screenshot E2" },
  { "id": "D2", "fulfilledPct": 50, "rationale": "Only 10 of 20 menu items present; E1" },
  { "id": "D3", "fulfilledPct": 0, "rationale": "Form does not send email; E3 video" }
]}
```

2. **Deterministic step.** A formula, not the LLM, computes the split:

```
buyerBps = Σ floor(weightBps_i × (100 − fulfilledPct_i) / 100)
         = 5000×0/100 + 3000×50/100 + 2000×100/100 = 0 + 1500 + 2000 = 3500  → 35% refund to buyer, 65% to seller
```

**Rounding:** floor is applied per deliverable, and the remainder (at most 1 bps per deliverable) goes to the seller. This matches the contract's `toSeller = amount − toBuyer`. Example: weights 3333/3333/3334 with every score at 50 → 1666 + 1666 + 1667 = **4999** bps to the buyer (not 5000), so the seller gets 5001.

3. **On-chain step.** `reasoningHash = keccak256(canonicalJSON({ scores, buyerBps, model, promptVersion, inputsHash }))`. The agent wallet then calls `proposeResolution(id, buyerBps, reasoningHash)`.

This gives you:
- **Explainable** rulings: each deliverable has a score and a rationale.
- **Deterministic** payouts: the same scores always produce the same split.
- **Auditable** decisions: anyone can recompute the hash and the formula.
- **Safe** execution: the agent can't move money.

**Prompt-injection defence:** evidence is untrusted input. Put it in a clearly delimited data block in the prompt and instruct the model to treat it as data only. Validate the output against a JSON schema, and reject scores that aren't integers from 0 to 100 or unknown deliverable IDs.

---

## 8. MST integration walkthrough

### 8.1 MST testnet + EVM contracts (core — must have)

1. Add the MST testnet to MetaMask: RPC `https://testnetrpc.mstblockchain.com`, chain ID `91562037`, symbol MSTC.
2. Get testnet MSTC from the organizers or a faucet for **three wallets**: deployer/ORG, agent, and arbitrator.
3. Set up and deploy:
   ```bash
   cd contracts
   forge install foundry-rs/forge-std OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
   # remappings.txt:  @openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
   export AGENT_ADDRESS=0x... ARBITRATOR_ADDRESS=0x...
   forge script script/Deploy.s.sol --rpc-url $MST_RPC_URL --private-key $PRIVATE_KEY --broadcast
   ```
4. Verify both contracts on the MST explorer. Record the addresses in `deployments.md`.
5. In the frontend, define the chain with viem's `defineChain` (see README §5.6) and read or write through the contract ABI (`contracts/out/DealEscrow.sol/DealEscrow.json`).

### 8.2 SARAL — keyless login (strong differentiator, target by hour 14)

- **Where:** step 1, login. The notebook asks for login through an authenticated device; SARAL's MPC key share lives on the user's device, so this maps directly.
- **How:** get the SDK from MST mentors at kickoff. Wire the SARAL login, read the user's wallet address, and send contract transactions through the SARAL signer.
- **Also:** SARAL verifies the user's mobile number. Treat that as a first-level KYC signal before the mock document upload.
- **Gas:** new SARAL wallets have 0 MSTC. Either the backend sends a small amount from a team wallet after KYC approval, or you use sponsored transactions if SARAL supports them (ask the mentors).
- **Fallback:** MetaMask login, with SARAL shown as work in progress in the pitch.

### 8.3 WASMify — verifiable dispute computation (stretch, high impact)

- **Where:** step 13, the split computation.
- **What:** compile the deterministic split formula (§7.2) to WASM and run it through WASMify. You get a verifiable execution record anchored on MST, so the payout provably follows the formula applied to the committed scores.
- **How:** SDK access and docs come from MST mentors (not public). Put WASMify's proof or receipt ID into `reasoningHash`.
- **Fallback (still solid):** the commit-hash approach in §7.2 plus a public "verify ruling" page. The page takes the stored scores, recomputes the formula and hash in the browser, and shows ✅ if they match the on-chain value.

### 8.4 Stablecoin

- MVP: `MockUSD` (6 decimals, owner-mintable by the on-ramp backend).
- If the organizers give minting access to Masterstroke's tMUSD, swap in its address. The escrow contract accepts any ERC-20 in its constructor.

### 8.5 BridgeKey, mstscan, post-quantum

- **BridgeKey:** list it as a supported wallet for users who already have MST funds (the `fund()` path).
- **mstscan:** every timeline step in the UI links to its transaction. This is the **proof** moment in the demo.
- **Post-quantum layer:** a pitch point for long-lived escrow agreements and signatures. It's roadmap only; don't claim you integrated it.

---

## 9. Backend API

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/auth/saral` | Exchange SARAL session → user record + address |
| POST | `/kyc/submit` | Upload mock documents |
| POST | `/admin/kyc/:address/approve` | Calls `setKyc` + gas drip |
| POST | `/deals` | Buyer creates draft: payee, purpose, price, constraints |
| POST | `/deals/:id/seller-input` | Seller's points |
| POST | `/deals/:id/merge-sow` | Agent merges → SOW JSON + hash |
| POST | `/deals/:id/approve-sow` | Party approves the current SOW version |
| POST | `/onramp/:id/pay` | Mock UPI → mint MockUSD → `fundFor` |
| POST | `/deals/:id/delivery` | Upload proof → returns `deliveryHash` |
| POST | `/deals/:id/dispute` | Upload evidence → returns `evidenceHash` |
| POST | `/deals/:id/resolve` | Agent scores → `proposeResolution` |
| GET | `/deals/:id` | Merged off-chain data + on-chain state |
| GET | `/deals/:id/verify` | Recompute split + reasoning hash vs on-chain |

**Event indexer:** subscribe to contract events over the WebSocket RPC and update SQLite, so the UI never polls the chain directly.

**Keys:**
- ORG, agent and arbitrator keys live only in the backend `.env`, testnet only.
- The agent key's only power is `proposeResolution`.

---

## 10. Frontend screens

1. Login (SARAL / MetaMask)
2. KYC upload + status
3. Dashboard (my deals as buyer / seller)
4. New deal (payee, purpose, price, constraints)
5. SOW workspace (buyer and seller inputs → merged SOW → approve)
6. Pay (mock UPI)
7. **Deal tracker:** a timeline of every transition, each with its mstscan link
8. Dispute (evidence upload)
9. Resolution (per-deliverable scores, split, Accept / Escalate)
10. Arbitrator console
11. Verify ruling page

---

## 11. MVP scope

**Must:**
- Contracts deployed and verified on MST testnet
- Login (SARAL or MetaMask) and mock KYC
- Deal draft + seller input + AI SOW merge + on-chain propose/accept
- Mock on-ramp → `fundFor`
- Delivery → release
- Dispute → agent proposal → accept
- Escalate → arbitrate
- Deal tracker with mstscan links

**Should:**
- SARAL (if MetaMask is the fallback)
- Timeout demo (set `reviewPeriod` to 120 s)
- Verify-ruling page

**Stretch:**
- WASMify integration
- Evidence on IPFS
- Milestone-based deals

**Won't (say so in the pitch as roadmap):**
- Real fiat on-ramp or off-ramp
- Real KYC provider
- Platform fees
- Multi-token support
- Arbitrator staking or reputation

---

## 12. Team split & 24-hour plan

| Role | Owns |
|---|---|
| **Contracts** | Deploy + verify, Foundry tests, ABI export, event indexer, `deployments.md` |
| **Backend + Agent** | Express API, SQLite, LLM SOW merge + dispute scoring, split formula, on-ramp mock, KYC admin |
| **Frontend** | All screens, viem wiring, deal tracker, mstscan links |
| **Integration + Pitch** | SARAL, WASMify, gas drip, demo data seeding, architecture slide, demo script, backup recording |

| Hours | Milestone |
|---|---|
| 0–2 | Contracts deployed to MST testnet; API skeleton; screens stubbed; SARAL/WASMify SDK access requested |
| 2–8 | Happy path end to end: draft → SOW merge → propose/accept → fund → deliver → release |
| 8–14 | Dispute path: evidence → agent scores → propose → accept; escalate → arbitrate |
| 14–18 | SARAL login; verify-ruling page; WASMify attempt |
| 18 | **Feature freeze** |
| 18–22 | Seed demo data, polish, fix bugs, record a backup video |
| 22–24 | Rehearse the pitch 3×; prepare Q&A |

---

## 13. Demo script (~4 minutes)

1. **Problem (20 s):** freelancers and small businesses get scammed both ways, either paid late or paid for incomplete work. Escrow platforms are custodial and their dispute resolution is opaque.
2. **Login with Google through SARAL (20 s):** no seed phrase.
3. **Create a deal (40 s):** buyer constraints plus seller points, the agent merges them into a weighted SOW, both approve. Show `proposeDeal` / `acceptDeal` on mstscan with the SOW hash.
4. **Pay ₹ via mock UPI (20 s):** show `DealFunded` on mstscan, with funds sitting in the **contract**, not our wallet.
5. **Dispute (60 s):** the seller delivers partially and the buyer raises a dispute with evidence. The agent scores each deliverable and the formula gives a 35/65 split. Show `ResolutionProposed`, both accept, and the split payout on mstscan.
6. **Verify ruling (20 s):** recompute the hash in the browser; it matches the on-chain value ✅.
7. **Escalation (20 s):** a pre-seeded second deal where the seller rejects the proposal, and the arbitrator rules.
8. **Architecture + roadmap (30 s).**

---

## 14. Expected judge questions

- **Why not a database?** The platform can't take the funds or override the rules; both parties' agreement and every ruling are publicly verifiable. A database would require trusting us.
- **Can the AI steal or misallocate funds?** No. It can only propose. Payout requires both parties' acceptance or the arbitrator's ruling, and this is enforced in the contract.
- **What if the AI is wrong?** Either party escalates to a human, and the AI's reasoning is hashed on-chain for review.
- **Privacy?** No personal data on-chain, only hashes and a KYC boolean.
- **Who is the arbitrator, and isn't that centralized?** For the MVP, yes: a single role key. The roadmap is a staked arbitrator pool with random selection and reputation.
- **Why MST?** EVM compatibility, 3-second blocks, low fees (so many small transactions per deal are affordable), SARAL for mainstream onboarding, and WASMify for verifiable off-chain computation.
- **What does the ORG actually do?** Fiat on-ramp, KYC, and running the agent. It never custodies the funds.

---

## 15. Open questions for MST mentors (ask at kickoff)

1. SARAL SDK access and docs; does it support sponsored (gasless) transactions?
2. WASMify SDK access; can it attest a pure WASM function's output on-chain?
3. Testnet faucet, or testnet MSTC for our 3 system wallets + demo users.
4. Testnet explorer URL (mstscan is mainnet).
5. Minting access to tMUSD, or should we deploy our own mock stablecoin?
