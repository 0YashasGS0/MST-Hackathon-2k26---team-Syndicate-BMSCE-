# Deployment on Mainnet (Testnet → Mainnet checklist)

> Source: MST official developer docs (docs.mstblockchain.com), copied 2026-09-29 for team reference. Not our content — check the live docs for updates.

Mainnet deployment is **irreversible**; contracts hold real funds.

## 1. Security review
- Internal peer review; automated analysis (Slither, MythX, Echidna, Foundry fuzzing); third-party audit for production contracts holding funds.
- Common attack vectors: reentrancy (`ReentrancyGuard`, CEI), overflow (auto-checked in ^0.8), front-running/MEV, DoS (unbounded loops), access control, malicious external calls, upgrade safety, dangerous opcodes (`selfdestruct`, `delegatecall`).

## 2. Gas optimisation
Minimise storage writes; `calldata` over `memory` for external params; minimal events; pack variables; `immutable`/`constant`; cache computations; mappings for sparse lookups; bounded loops; optimiser on (`--optimize-runs=200` or higher).

## 3. Testing & simulation
Unit tests (edge cases, reverts, max values), integration tests (full flows), fuzzing/invariants, mainnet-fork testing.

## 4. Deployment preparation
Double-check constructor args; secrets in env vars; scripted deploys (Hardhat/Foundry); check the block gas limit; keep an address book; tag the deploy commit.

## 5. Post-deployment
Verify source on MSTScan; transfer ownership to a multisig; monitor events/txs; test pause/emergency features; bug bounty; upgrade governance (if proxy).

## 6. Documentation & transparency
Clear README; document admin roles and privileges; publish audits and known risks; share gas benchmarks.

## 7. Mindset
Treat testnet like mainnet; expect malicious actors; minimise trust; design for maintainability.

## 8. Network configuration

Hardhat:
```javascript
require("@nomicfoundation/hardhat-toolbox");
module.exports = {
  solidity: "0.8.20",
  networks: {
    testnet: { url: "https://testnetrpc.mstblockchain.com", accounts: [process.env.PRIVATE_KEY], chainId: 91562037 },
    mainnet: { url: "https://mariorpc.mstblockchain.com", accounts: [process.env.PRIVATE_KEY], chainId: 4646, gasPrice: "auto" },
  },
};
```

Foundry (`foundry.toml`):
```toml
[rpc_endpoints]
testnet = "https://testnetrpc.mstblockchain.com"
mainnet = "https://mariorpc.mstblockchain.com"

[profile.default]
src = "src"
out = "out"
libs = ["lib"]
```

Deploy:
```bash
npx hardhat run scripts/deploy.js --network mainnet
# or
forge script script/Deploy.s.sol --rpc-url mainnet --broadcast
```

Verification: MSTScan is Blockscout-based. See https://docs.blockscout.com/devs/verification
