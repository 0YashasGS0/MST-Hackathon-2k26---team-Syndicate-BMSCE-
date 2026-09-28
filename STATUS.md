# Build Status — Team Kernel Exploits

Newest entries first. Updated by teammates and Claude Code after every task.

## Current state

- **Phase:** Pre-kickoff
- **Problem statement:** TBD
- **Deployed contracts:** none yet (see `deployments.md`)

## Decisions

| Time | Decision | Why |
|---|---|---|
| 2026-09-29 | FE is a UPI-style app (phone + OTP login bound to one device, one-time KYC, single scrolling home) | Users are non-crypto; hashes, addresses, chain name hidden everywhere |
| 2026-09-29 | Arbitrator console removed from the user app | Will be a separate admin surface later |
| 2026-09-29 | Amounts shown in ₹ at a fixed display rate (84) | Until PG's on-ramp quote endpoint exists |

## Blockers

- None

## Log

### 2026-09-29 — FE: sender / receiver toggle
- `/pay/new` has "I'm paying" / "I'm getting paid". A receiver's request goes through the same agreement step; the payer then pays.
- `createDraft` now takes `{ role, counterparty, purpose, price, terms }`; Draft gains `initiator` and `buyerName` (needs B2 agreement)

### 2026-09-29 — FE: UPI-style redesign (branch `chandana`)
- Routes: `/` login (phone + OTP, device-bound) → `/kyc` (first time only) → `/home` (Initiate payment → In progress → Payment history)
- `/pay/new` → `/pay/agreement/[draftId]` (AI-drafted SOW, agree) → `/txn/[id]/pay` (UPI)
- `/txn/[id]` details on tap: transaction ID, initiated on, released on, SOW; release / raise complaint
- `/txn/[id]/complaint` with photo/video proof upload (UI only; file storage TODO) → `/txn/[id]/resolution` (status, split, per-part scores, accept / escalate)
- Removed: dashboard, arbitrator console, verify (hash) page, MST testnet pill, wallet address button, footer
- Installable as a phone app (web manifest + icon)
- **Needs backend agreement:** new endpoints in `frontend/lib/api.ts` — `/auth/otp`, `/auth/saral` with `{phone, otp, deviceId}`, `/auth/device`, `/deals/:id/complaint`, `/deals/:id/release|accept|escalate`, display names on Deal/Draft. All mocked for now.

### 2026-09-29 — FE
- `frontend/` scaffold done: Next.js 16 + Tailwind + viem, MST chain config, typed API client fully mocked (see `docs/progress/FE.md`)
- Waiting on `docs/API.md`, `deployments.md`, ABI

### Pre-kickoff
- README.md team briefing added
- CLAUDE.md added for Claude Code context
