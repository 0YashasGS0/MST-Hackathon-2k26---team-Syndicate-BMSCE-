# Deployments — MST Testnet (chain 91562037)

> Owner: B1. Update immediately after every deploy. Addresses only — never keys.

| Contract | Address | Deploy tx | Block | Explorer | Verified |
|---|---|---|---|---|---|
| MockUSD | — (not deployed yet) | — | — | — | ⬜ |
| DealEscrow | — (not deployed yet) | — | — | — | ⬜ |

> The previous values here were placeholders: they equalled the demo buyer/seller **wallet** addresses below, with an all-zero deploy tx.
> Deploy with `cd contracts && npm ci && node deploy.js` (or `forge script script/Deploy.s.sol`); both deploy MockUSD,
> DealEscrow(usd, agent, arbitrator) and approve the escrow from ORG. `deploy.js` checks the result on-chain and prints
> the rows for this table and the env values.

## System wallets (addresses only)
| Role | Address |
|---|---|
| ORG / deployer (owner) | 0x33De3D1F0953052230475C2215F478d0E1AafF74 |
| Agent | 0x302E3f28A9a08CFBC2D808083101FBc7475CC2Ef |
| Arbitrator | 0x7b7BEb8a22682f02f0F794177F00e0A5C3d2cb1d |
| Demo buyer | 0x8aEc97AA15A442E1130ca8573eAC0453752D5c6e |
| Demo seller | 0x52719e0a72C0631cD9654a6039aB69206d9f7704 |

## Config
- `reviewPeriod` used for demo deals: 120
- Testnet explorer URL: https://testnet.mstscan.com (official, Blockscout-based; see `docs/sdk/README.md`)
