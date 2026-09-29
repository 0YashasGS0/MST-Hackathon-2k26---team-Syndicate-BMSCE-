# MST SDK & official docs (team reference)

Agents: use ONLY what's in this folder for MST-specific tools. Never guess SARAL/WASMify APIs.

| File | What it covers |
|---|---|
| `mst-testnet.md` | Testnet network details, faucet, best practices |
| `mst-sdk.md` | Official SDKs: `@mstblockchain/mst-sdk` (JS/TS) and `mst-sdk-python` |
| `vibe-kit.md` | `create-mst-app` scaffolder: templates, scripts, network config |
| `mcp.md` | Official `mst-mcp` documentation server for AI assistants |
| `ide-hands-on.md` | Deploying an MEP-20 token with Remix + MetaMask |
| `mainnet-deploy.md` | Testnet → Mainnet checklist, Hardhat/Foundry mainnet config |

## Confirmed by the official docs
- Testnet: chain ID `91562037`, RPC `https://testnetrpc.mstblockchain.com`.
- **Official testnet explorer: `https://testnet.mstscan.com`** (previously marked "community-reported"; now confirmed). It has an **Add MST Testnet** button for MetaMask.
- Faucet: `https://faucet.mstblockchain.com/`, **fixed amount per request**.
- Mainnet: chain ID `4646`, RPC `https://mariorpc.mstblockchain.com`.
- MSTScan is Blockscout-based, so contracts are verified via Blockscout's verification (`forge verify-contract --verifier blockscout`; confirm the API URL on the explorer, typically `https://testnet.mstscan.com/api/`).
- **MEP-20** is MST's name for the ERC-20 standard. Our MockUSD is an MEP-20 stablecoin (use this term in the pitch).
- Official JS SDK exists: `@mstblockchain/mst-sdk`. Read its quickstart before using it (TODO: add `mst-sdk-js.md`).
- Official MCP server `https://mcp.mstblockchain.com/sse` is **documentation-only**; it never needs keys.

## Corrections to our docs
- Testnet currency symbol is **tMSTC** (we wrote MSTC). Use `tMSTC` in MetaMask and `defineChain` nativeCurrency symbol; amounts and decimals are unchanged (18).
- Explorer: drop the "community-reported" caveat from `MST_Services.pdf`, `MST_Testnet_Funding.pdf` and `deployments.md`.

## Still NOT in the official docs (ask MST mentors)
- **SARAL** SDK / login flow / session verification / sponsored transactions
- **WASMify** SDK / proof format
- Faucet claim amount and cooldown; extra testnet funds for our 5 wallets
- Judging: is testnet deployment enough, or is mainnet expected?
