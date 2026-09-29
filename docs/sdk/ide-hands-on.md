# IDE & Hands-on: Deploy an MEP-20 token (Remix + MetaMask)

> Source: MST official developer docs (docs.mstblockchain.com), copied 2026-09-29 for team reference. Not our content — check the live docs for updates.

**MEP-20** is MST's name for the ERC-20-equivalent token standard.

## Step 1 — Configure with OpenZeppelin Wizard
1. Open https://wizard.openzeppelin.com/#erc20
2. Set token name and symbol (e.g. replace `MyToken` / `MTK`).
3. Set the premint amount (e.g. `1_000_000`).
4. Click **Open in Remix**.

## Step 2 — Prerequisites
- MetaMask browser extension.
- MST Testnet added to MetaMask: open https://testnet.mstscan.com/, scroll to the bottom, click **Add MST Testnet**.
- tMSTC in the wallet from https://faucet.mstblockchain.com
- First-time Remix users: accept the AI/analytics preferences; choose "Learning".

## Step 3 — Remix basics
Browser-based IDE: File Explorer, Solidity Compiler, Deploy & Run Transactions, Debugger & Logs. Nothing to install.

## Step 4 — Deploy
1. Open **Deploy & Run Transactions**.
2. Environment → **Injected Provider – MetaMask** (if missing: *Customise this list* → enable *Deploy through the MetaMask browser extension*).
3. Select MST Testnet in MetaMask.
4. **Solidity Compiler** → Compile.
5. Back to Deploy & Run → **Deploy** → confirm in MetaMask.
6. The contract appears under **Deployed Contracts**; copy its address.

## Step 5 — Verify deployment
Check **Deployed Contracts** in Remix, or paste the address into https://testnet.mstscan.com/
