# Team Status (shared)

> Team-level state only. Per-person detail lives in `docs/progress/`.
> Update when: a checkpoint changes, contracts are deployed or redeployed, or a team-wide blocker appears.

## Checkpoints
| Hour | Goal | Status |
|---|---|---|
| 1 | Contracts live + verified; `docs/API.md` frozen | ⬜ |
| 4 | Happy path via API | ⬜ |
| 6 | Happy path in UI | ⬜ |
| 7 | WASMify decision (SDK or fallback) | ⬜ |
| 8 | Dispute path in UI | ⬜ |
| 8.5 | SARAL decision (SARAL or MetaMask) | ⬜ |
| 10 | Feature freeze | ⬜ |

## Deployed (see deployments.md for full details)
- MockUSD: —
- DealEscrow: —

## Team-wide blockers
- none

## Decisions
| Time | Decision | By |
|---|---|---|
| pre | Software-only (no hardware kit) | Team |
| pre | Dispute scores are integers 0–100; split computed only by shared formula | Team |
| hour 7 | No WASMify SDK (docs/sdk/ has none) → browser verify fallback: `split.wasm` + `verifyRuling()` run client-side; no WASMify integration | B2 |
| 09-28 | SOW hash = keccak256(RFC 8785 canonical JSON) via `shared/` `hashSow` (schema draft `sow/v1`, tests passing; see `docs/progress/B2.md`) | B2 |
| 09-29 | PG on-ramp sessions include a UPI URI; confirmation stores the selected payment method as display-only metadata | PG |
| 09-29 | FE is a UPI-style app (phone + OTP login bound to one device, one-time KYC, single scrolling home); hashes, addresses and chain name hidden from users | FE |
| 09-29 | Arbitrator console is a separate admin surface, not part of the user app | FE |
| 09-29 | Amounts shown in ₹ at a fixed display rate (84), matching PG's demo quote | FE |
| 09-29 | Security hardening + Docker/Caddy deployment (`SECURITY.md`, `docs/DEPLOY.md`); production start refuses unsafe config; CI on every PR | B2 (owner request) |
| 09-29 | All FE calls have real endpoints; users sign escrow actions with their own wallet; device-key registry live; ports 5000 (API) / 3000 (app); contracts NOT yet deployed (deployments.md placeholders removed) | B2 (owner request) |
