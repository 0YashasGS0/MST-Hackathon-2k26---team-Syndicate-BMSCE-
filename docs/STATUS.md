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
| 09-28 | SOW hash = keccak256(RFC 8785 canonical JSON) via `shared/` `hashSow` (schema draft `sow/v1`, tests passing; see `docs/progress/B2.md`) | B2 |
| 09-29 | PG on-ramp sessions include a UPI URI; confirmation stores the selected payment method as display-only metadata | PG |
