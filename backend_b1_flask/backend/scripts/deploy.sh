#!/usr/bin/env bash
# Deploy MockUSD + DealEscrow to MST with Foundry (run from repo root or backend/).
# Needs in env: MST_RPC_URL, ORG_KEY, AGENT_ADDRESS, ARBITRATOR_ADDRESS   (addresses, not keys, for the last two)
set -euo pipefail
cd "$(dirname "$0")/../../contracts"
: "${MST_RPC_URL:?}" "${ORG_KEY:?}" "${AGENT_ADDRESS:?}" "${ARBITRATOR_ADDRESS:?}"
forge script script/Deploy.s.sol --rpc-url "$MST_RPC_URL" --private-key "$ORG_KEY" --broadcast
echo
echo "Now copy the printed MockUSD / DealEscrow addresses into backend/.env (USD_ADDRESS, ESCROW_ADDRESS)"
echo "and set DEPLOY_BLOCK to the deployment block (see contracts/broadcast/Deploy.s.sol/*/run-latest.json)."
