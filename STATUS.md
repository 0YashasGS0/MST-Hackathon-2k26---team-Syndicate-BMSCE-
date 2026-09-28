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

### 2026-09-29 — FE: device security, account, people
- New-device login = OTP + security PIN (seeded PIN 1234); old device removed; 24 h cooling (payments > ₹5,000 blocked); 5 wrong OTP/PIN → 5 min lock
- PIN set once after KYC (`/setup-pin`); app locks with PIN on open and after 2 min in background; PIN needed to sign and release
- `/account`: My QR, security info, How to use (`/account/guide`), FAQs, Help & support (ticket form, not sent anywhere yet)
- Home "People" grid → `/people/[phone]` chat-style history (sent right / received left); Pay/Request from there
- Pay form shows KYC banking name before amount; amount chips and card payments removed; QR upload via file, drag & drop, paste
- Gap: SIM binding needs a native app; PIN reset flow not built

### 2026-09-29 — FE: two-party flow, signatures, QR, checkout, arbitrator
- Fake backend now runs on the Next dev server (`app/api/mock` → `lib/mocks.ts`), shared by every browser/phone; resets on restart
- Test logins (OTP 123456): Priya 9000000001 (buyer), Ravi 9000000002 (seller), Arbitrator 9000000009
- Conflicting terms (e.g. delivery date) block signing until both parties enter the same value — no auto middle ground
- "Agree & sign" signs the agreement hash with a per-device key (registered at login); server + other party verify it
- Pay / Request are separate buttons (no toggle); `/qr` shows a personal QR (Get paid / Pay someone) + `/qr/scan`
- Checkout: UPI QR, UPI ID collect, UPI app (phones), card, linked crypto wallet — all mocked
- Seller can mark delivered; resolution needs both parties to accept; `/arbitrator` console rules on escalated cases
- Device binding enforced across devices via the shared mock (checked every 15 s). **Nothing is deployed**; real enforcement needs PG's `/auth/saral` + `/auth/device`
- **Needs backend agreement:** new endpoints in `frontend/lib/api.ts` (addTerms, proposeConflict, signSow with signature, markDelivered, onrampConfirm method, linkWallet, lookupContact, listCases, arbitrate with note)

### 2026-09-29 — FE: visual polish + history page
- Payment history moved to its own `/history` page (search, All / Paid / Received filters); home keeps pending payments
- Home: green banner with "held safely" total, Pay / Request / History action tiles
- New look across screens: softer cards, filled inputs, icon rows (`components/icons.tsx`), receipt-style transaction details

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
