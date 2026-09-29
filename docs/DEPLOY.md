# Deploying

One VM (or any Docker host) runs three containers: **Caddy** (HTTPS), the **frontend** (Next.js) and the
**backend** (Express + SQLite on a volume). The contracts must be deployed to MST testnet first (B1: `cd contracts && npm ci && node deploy.js`) and
their addresses recorded in `deployments.md`; the backend and the frontend's on-chain actions need them.

```
browser ── https://app.example.com ──► Caddy ──► frontend:3000
        └─ https://api.example.com ──► Caddy ──► backend:5000 ──► MST RPC, LLM API, SQLite volume
```

Use **two subdomains of one domain** (same-site). PG's session cookie is `SameSite=Lax`, so the browser sends it
to the API only when app and API are same-site.

## 1. Prerequisites
- A host with Docker + Compose, ports 80/443 open, and DNS `A` records for both subdomains pointing at it.
- Funded testnet system wallets (ORG, agent, arbitrator).
- `DealEscrow` + `MockUSD` deployed on MST testnet, with their addresses and deploy block filled in `deployments.md`.
- An LLM key (`GROQ_API_KEY` / `GEMINI_API_KEY`, see `docs/progress/B2.md`).

## 2. Configure
```bash
cp backend/.env.example backend/.env
```
Set at least (generate every secret with `openssl rand -hex 32`):

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `AUTH_DOMAIN` | `app.example.com` |
| `AUTH_SESSION_SECRET` | random, ≥ 32 bytes |
| `BACKEND_API_KEY` | random, ≥ 16 bytes (also given to the frontend build) |
| `ADMIN_TOKEN` | random, ≥ 24 bytes — operator/arbitrator only, never in the frontend |
| `ARBITRATOR_ADDRESSES` | wallets that get the arbitrator console (comma-separated) |
| `CORS_ORIGINS` | `https://app.example.com` |
| `TRUST_PROXY` | `1` (Caddy in front) |
| `ORG_KEY`, `AGENT_KEY`, `ARBITRATOR_KEY` | the system wallets |
| `ESCROW_ADDRESS`, `USD_ADDRESS`, `DEPLOY_BLOCK` | from `deployments.md` |
| `LLM_CHAIN` + its key(s) | e.g. `groq:openai/gpt-oss-120b` + `GROQ_API_KEY` |

`AUTH_DEV_HEADER`, `AGENT_DEMO_FALLBACK` and `AGENT_FALLBACK_ON_FAILURE` must stay off. **The backend refuses to
start in production** if any of the rules above is violated (it prints every problem).

## 3. Run
```bash
export APP_DOMAIN=app.example.com API_DOMAIN=api.example.com
export NEXT_PUBLIC_API_KEY=<same value as BACKEND_API_KEY>
export NEXT_PUBLIC_ESCROW_ADDRESS=0x… NEXT_PUBLIC_USD_ADDRESS=0x…
docker compose up -d --build
docker compose logs -f backend   # "[backend] listening on :5000", indexer backfilling
```
`NEXT_PUBLIC_*` values are baked into the frontend (and its CSP) at build time: rebuild the frontend after changing
them. `NEXT_PUBLIC_LIVE_ENDPOINTS` defaults to `*` (every call goes to the real backend).

## 4. Verify
- `https://app.example.com` loads; response headers include `Content-Security-Policy` and `Strict-Transport-Security`.
- `curl -s https://api.example.com/drafts` → `401 Unauthorized` (identity is required).
- Sign in with a wallet, create a draft, merge, sign; `GET /deals/:id/verify` after a ruling.

## Operations
- **Data:** SQLite + uploads live in the `backend-data` volume. Back it up:
  `docker compose exec backend node -e "require('better-sqlite3')('/app/backend/data/app.db').backup('/app/backend/data/backup.db')"`,
  then copy `backup.db` off the host.
- **Secrets rotation:** changing `AUTH_SESSION_SECRET` signs everyone out; changing `BACKEND_API_KEY` needs a
  frontend rebuild; `ADMIN_TOKEN` only affects operators.
- **Updates:** `git pull && docker compose up -d --build`. CI (`.github/workflows/ci.yml`) must be green first.
- **Local dev** (no Docker): `cd shared && npm ci`, `cd backend && npm ci && npm run dev`, `cd frontend && npm ci && npm run dev`.

See `SECURITY.md` for the threat model and what each control covers.
