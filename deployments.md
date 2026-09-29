# Deployments — MST Testnet (chain 91562037)

> Owner: B1. Update immediately after every deploy. Addresses only — never keys.

| Contract | Address | Deploy tx | Block | Explorer | Verified |
|---|---|---|---|---|---|
| MockUSD | 0x528707B3CD2266c07744b680b5c9dc08a9886472 | [0x371bedf5…a84c](https://testnet.mstscan.com/tx/0x371bedf54c9960fe5fe3975f1db8814bb283c091d5409633cffb49c5dcada84c) | before 5800981 (see tx) | [MockUSD](https://testnet.mstscan.com/address/0x528707B3CD2266c07744b680b5c9dc08a9886472) | ⬜ |
| DealEscrow | 0x653aA806b4b00d13446aEbA96A6bE60A68B1AefA | [0x9bed6edf…c170](https://testnet.mstscan.com/tx/0x9bed6edfceff6949fcd22142ea5c2c18c125169d103136cb7911e1356c24c170) | **5800981** (`DEPLOY_BLOCK`) | [DealEscrow](https://testnet.mstscan.com/address/0x653aA806b4b00d13446aEbA96A6bE60A68B1AefA) | ⬜ |

> Deployed by B1 with ORG as owner; agent and arbitrator are the wallets below. On-chain checks at deploy passed (owner,
> agent, arbitrator, stablecoin, decimals, ORG→escrow allowance). "Verified" = source verified on the explorer (not yet).
> Redeploy: `cd contracts && npm ci && node deploy.js --write`; re-check any time with `cd backend && npm run preflight`.

## System wallets (addresses only)
| Role | Address |
|---|---|
| ORG / deployer (owner) | 0x33De3D1F0953052230475C2215F478d0E1AafF74 |
| Agent | 0x28c36DaC3B031b251C59932b54f006eE7EC0faC1 |
| Arbitrator | 0xA190015927878755B1749787927db02Db7440fcE |
| Demo buyer | 0x8aEc97AA15A442E1130ca8573eAC0453752D5c6e |
| Demo seller | 0x52719e0a72C0631cD9654a6039aB69206d9f7704 |

## Config
- `reviewPeriod` used for demo deals: 120
- Testnet explorer URL: https://testnet.mstscan.com (official, Blockscout-based; see `docs/sdk/README.md`)
