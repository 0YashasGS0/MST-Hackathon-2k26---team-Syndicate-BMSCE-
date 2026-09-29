# Yescro — frontend

The Yescro app: Next.js 16 (App Router) + Tailwind 4 + viem. A UPI-style payments app where hashes, addresses and the
chain stay out of the user's way.

## Run

```bash
npm ci
cp .env.example .env.local
npm run dev                  # http://localhost:3000
```

By default **every call goes to the built-in mock backend** (`app/api/mock` → `lib/mocks.ts`), so the app works without
the backend. Switch endpoints to the real backend one at a time with `NEXT_PUBLIC_LIVE_ENDPOINTS` (comma-separated
keys from `lib/api.ts`, or `*` for all) and point `NEXT_PUBLIC_API_URL` at it (`http://localhost:5000`). Mock test
logins and PINs are in `lib/mocks.ts`. In a production build the mock backend is off unless `ENABLE_MOCK_BACKEND=true`.

`npm run build` · `npx eslint .`

## How it talks to the rest

- `lib/api.ts` — typed client; shapes in `lib/types.ts` match `../docs/API.md`. Sends PG's session cookie and
  `X-API-Key` (`NEXT_PUBLIC_API_KEY`, a public app key, not a secret).
- `lib/wallet.ts` + `lib/pg-wallet.ts` — wallet sign-in (MetaMask / BridgeKey, or a per-browser demo wallet).
- `lib/onchain.ts` — the user's own wallet signs the escrow actions (`markDelivered`, `release`, `raiseDispute`,
  `acceptResolution`, `escalate`) on MST; `lib/contracts.ts` holds the ABI and addresses (`NEXT_PUBLIC_ESCROW_ADDRESS`).
- `lib/device-key.ts` — the per-device key that signs agreements; the backend accepts it once the device is bound.
- Security headers and the CSP are set in `next.config.ts`.
