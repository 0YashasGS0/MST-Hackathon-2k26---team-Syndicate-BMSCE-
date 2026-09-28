"""Seed four demo deals (Funded, Delivered, ResolutionProposed, Escalated) with a SOW each.

    python -m scripts.seed              # add four fresh deals on the configured contracts
    python -m scripts.seed --reset-db   # wipe the local DB first; the indexer re-reads history from DEPLOY_BLOCK

Needs ORG_KEY, AGENT_KEY, DEMO_BUYER_KEY, DEMO_SELLER_KEY in .env. Review period defaults to 120 s so the
timeout demo can happen on stage (SEED_REVIEW_SECONDS to change).
"""
import json
import os
import sys
import time

from eth_account import Account
from web3 import Web3

from app.chain import Chain
from app.config import Config
from app.db import Database
from app.indexer import Indexer
from app.integrations import gas_drip
from app.util import hash_json

DELIVERABLES = [("Design mockups", 5000), ("Frontend build", 3000), ("Documentation", 2000)]


def make_sow(buyer, seller, tag):
    return {"title": f"Demo project - {tag}", "buyer": buyer, "seller": seller,
            "price": {"amount": "100.00", "token": "mUSD"},
            "deliverables": [{"id": f"D{i+1}", "description": n, "acceptanceCriteria": [f"{n} delivered and reviewed"],
                              "deadline": "2026-12-31T00:00:00Z", "reviewPeriodHours": 48, "exclusions": [], "weightBps": w}
                             for i, (n, w) in enumerate(DELIVERABLES)]}


def seed(chain: Chain, db: Database, cfg, buyer, seller, review=120, amount=100_000_000, log=print):
    org = chain.accounts["org"]
    esc, usd = chain.escrow, chain.usd
    for a in (buyer.address, seller.address):
        if not chain.is_kyc(a):
            chain.send("org", esc.functions.setKyc(a, True))
        db.run("INSERT INTO users(address,kyc_level) VALUES(?,2) ON CONFLICT(address) DO UPDATE SET kyc_level=2", (a,))
        log(f"  kyc ok {a}  drip={gas_drip(chain, db, cfg, a)['dripped']}")
    ids = {}
    for stage in ("Funded", "Delivered", "ResolutionProposed", "Escalated"):
        sow = make_sow(buyer.address, seller.address, stage)
        sow_hash = hash_json(sow)
        deliver_by = chain.w3.eth.get_block("latest")["timestamp"] + 7 * 86400
        rc = chain.send(buyer, esc.functions.proposeDeal(seller.address, amount, bytes.fromhex(sow_hash[2:]), deliver_by, review))
        deal_id = esc.functions.nextDealId().call() - 1
        chain.send(seller, esc.functions.acceptDeal(deal_id, bytes.fromhex(sow_hash[2:])))
        chain.send("org", usd.functions.mint(org.address, amount))
        chain.send("org", esc.functions.fundFor(deal_id))
        draft = db.run("INSERT INTO drafts(buyer,seller,purpose,price,status) VALUES(?,?,?,?,?)",
                       (buyer.address, seller.address, sow["title"], "100.00", "approved"))
        db.run("INSERT INTO sow_versions(draft_id,version,sow_json,sow_hash,buyer_approved,seller_approved) VALUES(?,?,?,?,1,1)",
               (draft, 1, json.dumps(sow), sow_hash))
        db.run("""INSERT INTO deals(id,draft_id,buyer,seller,amount,status,sow_hash,sow_version) VALUES(?,?,?,?,?,?,?,1)
                  ON CONFLICT(id) DO UPDATE SET draft_id=excluded.draft_id""",
               (deal_id, draft, buyer.address, seller.address, str(amount), "Funded", sow_hash))
        if stage != "Funded":
            chain.send(seller, esc.functions.markDelivered(deal_id, Web3.keccak(text=f"delivery-{deal_id}")))
        if stage in ("ResolutionProposed", "Escalated"):
            chain.send(buyer, esc.functions.raiseDispute(deal_id, Web3.keccak(text=f"evidence-{deal_id}")))
            reasoning = {"dealId": deal_id, "sowHash": sow_hash, "scores": [
                {"id": "D1", "fulfilledPct": 100}, {"id": "D2", "fulfilledPct": 50}, {"id": "D3", "fulfilledPct": 0}],
                "buyerBps": 3500, "model": "seed", "promptVersion": "seed-0", "stub": True}
            h = hash_json(reasoning)
            db.run("INSERT OR REPLACE INTO reasonings(hash,json,source,created_at) VALUES(?,?,?,?)",
                   (h, json.dumps(reasoning), "seed", int(time.time())))
            chain.send("agent", esc.functions.proposeResolution(deal_id, 3500, bytes.fromhex(h[2:])))
        if stage == "Escalated":
            chain.send(seller, esc.functions.escalate(deal_id))
        ids[stage] = deal_id
        log(f"  seeded {stage:<19} -> deal #{deal_id}")
    return ids


def main():
    if "--reset-db" in sys.argv and Config.DB_PATH != ":memory:" and os.path.exists(Config.DB_PATH):
        os.remove(Config.DB_PATH)
        print("DB wiped.")
    for k in ("DEMO_BUYER_KEY", "DEMO_SELLER_KEY"):
        if not os.getenv(k):
            sys.exit(f"{k} missing from .env (run: python -m scripts.gen_wallets)")
    db = Database(Config.DB_PATH)
    chain = Chain(Config)
    chain.require_ready()
    t0 = time.time()
    ids = seed(chain, db, Config, Account.from_key(os.environ["DEMO_BUYER_KEY"]), Account.from_key(os.environ["DEMO_SELLER_KEY"]),
               review=int(os.getenv("SEED_REVIEW_SECONDS", "120")))
    n = Indexer(chain, db, Config).sync_once()
    print(f"Done in {time.time() - t0:.0f}s, indexed {n} events. Deals: {ids}")


if __name__ == "__main__":
    main()
