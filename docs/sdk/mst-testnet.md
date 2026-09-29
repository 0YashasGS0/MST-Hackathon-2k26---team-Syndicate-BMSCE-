# MST Testnet (Development Networks)

> Source: MST official developer docs (docs.mstblockchain.com), copied 2026-09-29 for team reference. Not our content — check the live docs for updates.

The **MST Testnet** is a dedicated environment for building, testing and experimenting before deploying to **MST Mainnet**. It follows the same protocol rules, consensus mechanism and transaction logic as Mainnet, but uses **free test MSTC** instead of real assets.

## Prerequisites (recommended reading in MST docs)
- Accounts – EOAs and contract accounts
- Transactions – how actions are initiated and executed
- Gas – fees, limits, execution costs
- Network & Validator Structure – Mainnet vs Testnet

## Why use the Testnet?
- **Smart contract testing** – deploy, debug and upgrade without risking funds
- **Transaction simulation** – transfers, approvals, swaps, contract interactions
- **DApp development** – iterate before going live
- **Validator & infrastructure testing** – nodes, API endpoints
- **Learning & experimentation**

## How it works
- Same rules as Mainnet: gas fees, block production and validator mechanics are identical.
- Only difference: **Testnet MSTC has no real-world value**. Every action still needs gas, paid in free test MSTC.

## Obtaining Testnet MSTC
1. **MST Faucet:** https://faucet.mstblockchain.com/ — a **fixed amount per request** (anti-abuse).
2. Test MSTC can't be traded or used outside the Testnet.

## Connecting
1. Open an MST-compatible wallet (MST Wallet, or MetaMask with a custom RPC).
2. Add/switch to MST Testnet.
3. Request MSTC from the faucet.
4. Deploy contracts / test DApps.

```
Network Name:    MST Testnet
RPC URL:         https://testnetrpc.mstblockchain.com
Chain ID:        91562037
Currency Symbol: tMSTC
Block Explorer:  https://testnet.mstscan.com
```

## Best practices
- Test thoroughly before Mainnet.
- Simulate real-world conditions (realistic gas, sizes, logic).
- Stay updated: **Testnet parameters may reset or upgrade more often than Mainnet.**
- Always double-check you're on Testnet.
