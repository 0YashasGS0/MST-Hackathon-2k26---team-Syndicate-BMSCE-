# MST Vibe Kit

> Source: MST official developer docs (docs.mstblockchain.com), copied 2026-09-29 for team reference. Not our content — check the live docs for updates.

A one-command scaffolder for a complete MST project: contracts, frontend, and testnet/mainnet configs baked in.

Package: [@mstblockchain/mst-vibe-kit](https://www.npmjs.com/package/@mstblockchain/mst-vibe-kit)

```bash
npm i @mstblockchain/mst-vibe-kit
npx create-mst-app
```

## Generated structure
```
my-mst-project/
├── packages/
│   ├── contracts/   Hardhat project · Solidity smart contracts
│   ├── frontend/    Next.js starter · wallet connect · generated hooks
│   └── shared/      TypeScript types · contract ABIs · constants
├── .env.example     Template for PRIVATE_KEY, RPC URLs (never commit secrets)
├── .env.local       .gitignored · local secrets (created for you)
├── package.json     workspaces · scripts for dev/deploy
└── turbo.json       task orchestration
```

## Networks (pre-wired in packages/contracts/hardhat.config.ts)
| Network | Chain ID | RPC |
|---|---|---|
| MST Testnet | `91562037` | `https://testnetrpc.mstblockchain.com` |
| MST Mainnet | `4646` | `https://mariorpc.mstblockchain.com` |

Only `PRIVATE_KEY` in `.env.local` is needed to deploy.

## CLI
Interactive: prompts for project name, template, package manager (pnpm/npm/yarn) and git init. Non-interactive:
```
npx create-mst-app my-app --template defi --pm pnpm --git --yes
```
| Flag | Values |
|---|---|
| `--template <name>` | `blank`, `token`, `rwa`, `defi`, `demo`, `certificate`, `insurance`, `supplychain` |
| `--pm <manager>` | `pnpm` (default), `npm`, `yarn` |
| `--git` / `--no-git` | initialise a git repo |
| `--skip-install` | skip dependency installation |
| `-y`, `--yes` | accept defaults |

## Templates
| Template | Standard | Includes |
|---|---|---|
| `blank` | — | Empty Hardhat config + `Hello.sol` |
| `token` | MEP-20 | Fungible token with mint/burn roles, full test suite |
| `rwa` | Permissioned ERC-20 | `RWAShareToken`: whitelist-gated transfers, admin-set NAV, burn-to-redeem emitting `RedemptionRequested` |
| `defi` | Staking + Vesting | `ProjectToken` + `Staking` (reward-per-second) + `Vesting` (linear, cliff, revocation), wired together |
| `demo` | NFT + MST SDK | `DemoNFT` (ERC-721) with Pinata IPFS minting, wallet/mint/transfer/gallery frontend, MST SDK burner-wallet playground |
| `certificate` | Soulbound ERC-721 | Non-transferable credentials, batch issuance, revocation, public `/verify/[tokenId]` page with QR |
| `insurance` | Parametric | On-chain premium quote, oracle-restricted `submitOracleData` auto-payout, pool funding/withdrawal |
| `supplychain` | Custody registry | Product registration, gated custody transfers, checkpoints, recall, public `/track/[productId]` with QR |

All templates use OpenZeppelin (`AccessControl`, `Pausable`, `ReentrancyGuard`), non-upgradeable by default. `marketplace` is on the roadmap.

## Built-in scripts
| Command | What it does |
|---|---|
| `npm run dev` | Hardhat node + Next.js on localhost:3000 |
| `npm run test` | Contract tests (Hardhat) |
| `npm run compile` | Compile + generate TS types |
| `npm run lint` | Solhint |
| `npm run deploy:testnet` | Deploy to MST Testnet |
| `npm run deploy:mainnet` | Deploy to Mainnet (needs `PRIVATE_KEY` + typed confirmation) |
| `npm run verify:testnet` / `verify:mainnet` | Verify source on MSTScan |
| `npm run clean` | Remove build artifacts |

The deploy script refuses to run without `PRIVATE_KEY`. On mainnet it prints the target chain and requires typing `yes, deploy to mainnet`. After deploying, addresses + ABIs are written to `packages/shared/src/contracts.ts` and `packages/contracts/deployments.json`.
