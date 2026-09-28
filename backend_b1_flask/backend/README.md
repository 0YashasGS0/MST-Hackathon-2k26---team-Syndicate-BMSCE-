# Backend — Chain & Data (B1) · Flask

## Run it locally (no chain needed to boot)
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # set API_KEY / ADMIN_TOKEN at minimum
python run.py                   # http://localhost:5000  ->  GET /health
```

## Go live on MST (hour 0–1)
```bash
python -m scripts.gen_wallets           # prints 5 ADDRESSES; keys land in .env.wallets -> copy into .env
# ask mentors for MSTC for those addresses, then:
export AGENT_ADDRESS=0x… ARBITRATOR_ADDRESS=0x…
source .env && bash scripts/deploy.sh   # Foundry deploy (contracts/ must exist at repo root)
# put ESCROW_ADDRESS, USD_ADDRESS, DEPLOY_BLOCK, EXPLORER_URL in .env; restart
curl localhost:5000/health              # chain.connected true, escrowConfigured true
```
ABIs: read from `contracts/out/<Name>.sol/<Name>.json` when Foundry has built them, otherwise `backend/abi/`.

## Demo data
```bash
python -m scripts.seed               # 4 deals: Funded / Delivered / ResolutionProposed / Escalated (120 s review window)
python -m scripts.seed --reset-db    # wipe local DB first
```

## Tests (local EVM, no network)
```bash
pip install "web3[tester]" && python -m pytest -q
```
Covers KYC + gas drip, happy path, indexer idempotency/restart, uploads + hashes, dispute → agent proposal → accept, formula split (5000/3000/2000 → 3500), escalation → arbitration, timeout, revert mapping, tampered scorer output, seed script.

## Layout
`app/chain.py` clients, tx sending, revert decoding · `app/indexer.py` event index · `app/routes.py` endpoints · `app/integrations.py` B2 scorer + PG gas drip hooks · `scripts/` wallets, deploy, seed.
API contract: `docs/API.md`.
