"""Hooks to other people's modules.

* score_dispute  -> B2 (AI agent). Called over HTTP when B2_SCORER_URL is set, else a flagged local stub.
* gas_drip       -> PG. Implemented here with the rules from TEAM_ROADMAP so B1's KYC approval works
                    on day one; PG can replace the body and keep the signature.
"""
import time

import requests
from web3 import Web3

from .errors import ApiError
from .util import hash_json

SINGLE_DELIVERABLE = [{"id": "D1", "weightBps": 10000}]


def compute_buyer_bps(deliverables, scores) -> int:
    """Mirror of shared/split.ts. Integer math only: buyerBps = sum floor(weight*(100-pct)/100)."""
    pct = {s["id"]: s["fulfilledPct"] for s in scores}
    return sum((d["weightBps"] * (100 - pct[d["id"]])) // 100 for d in deliverables)


def validate_scores(deliverables, scores):
    ids = [d["id"] for d in deliverables]
    got = [s.get("id") for s in scores]
    if sorted(ids) != sorted(got):
        raise ApiError("bad_scores", "Scorer must return every deliverable exactly once, with no unknown IDs.", 502)
    for s in scores:
        p = s.get("fulfilledPct")
        if not isinstance(p, int) or isinstance(p, bool) or not 0 <= p <= 100:
            raise ApiError("bad_scores", f"fulfilledPct for {s.get('id')} must be an integer 0-100.", 502)


def _stub(ctx):
    cycle = [100, 50, 0]
    dels = ctx["sow"].get("deliverables") or SINGLE_DELIVERABLE
    scores = [{"id": d["id"], "fulfilledPct": cycle[i % 3], "rationale": "STUB score for demo/testing.",
               "evidenceRefs": []} for i, d in enumerate(dels)]
    buyer_bps = compute_buyer_bps(dels, scores)
    reasoning = {"dealId": ctx["dealId"], "sowHash": ctx["sowHash"], "evidenceHash": ctx["evidenceHash"],
                 "deliveryHash": ctx["deliveryHash"], "scores": scores, "buyerBps": buyer_bps,
                 "model": "stub", "promptVersion": "stub-0", "stub": True}
    return {"scores": scores, "buyerBps": buyer_bps, "reasoningHash": hash_json(reasoning), "reasoning": reasoning}


def score_dispute(cfg, ctx: dict) -> dict:
    """ctx: dealId, sowHash, sow, delivery{...}, evidence{...}, deliveryHash, evidenceHash.
    Returns {scores, buyerBps, reasoningHash, reasoning}. buyerBps is ALWAYS recomputed here."""
    if cfg.B2_SCORER_URL:
        try:
            r = requests.post(cfg.B2_SCORER_URL, json=ctx, timeout=120)
            r.raise_for_status()
            out = r.json()
        except Exception as e:
            raise ApiError("scorer_unavailable", "The AI scorer is unavailable.", 502, detail=str(e)[:200])
    elif cfg.USE_STUB_SCORER:
        out = _stub(ctx)
    else:
        raise ApiError("scorer_not_configured", "Set B2_SCORER_URL or USE_STUB_SCORER=1.", 503)

    dels = ctx["sow"].get("deliverables") or SINGLE_DELIVERABLE
    validate_scores(dels, out["scores"])
    recomputed = compute_buyer_bps(dels, out["scores"])
    if out.get("buyerBps") is not None and int(out["buyerBps"]) != recomputed:
        raise ApiError("split_mismatch", "Scorer's buyerBps does not match the deterministic formula.", 502,
                       claimed=out["buyerBps"], recomputed=recomputed)
    out["buyerBps"] = recomputed
    if not str(out.get("reasoningHash", "")).startswith("0x") or len(out["reasoningHash"]) != 66:
        raise ApiError("bad_reasoning_hash", "Scorer returned an invalid reasoningHash.", 502)
    return out


def gas_drip(chain, db, cfg, address: str) -> dict:
    """Send MSTC once per address if its balance is low. Returns a small status dict."""
    user = db.one("SELECT gas_dripped FROM users WHERE address=?", (address,))
    if user and user["gas_dripped"]:
        return {"dripped": False, "reason": "already_dripped"}
    if chain.native_balance(address) >= Web3.to_wei(cfg.GAS_DRIP_MIN, "ether"):
        return {"dripped": False, "reason": "balance_sufficient"}
    res = chain.send_native("org", address, Web3.to_wei(cfg.GAS_DRIP_AMOUNT, "ether"))
    db.run("UPDATE users SET gas_dripped=1 WHERE address=?", (address,))
    return {"dripped": True, "tx_hash": res["tx_hash"], "amount_mstc": cfg.GAS_DRIP_AMOUNT}
