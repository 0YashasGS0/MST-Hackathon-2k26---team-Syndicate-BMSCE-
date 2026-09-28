import io
import json

from web3 import Web3

AMT = 100_000_000  # 100 mUSD (6 decimals)


def test_auth_required(env):
    assert env.client.get("/deals").status_code == 401
    assert env.client.get("/health").status_code == 200          # public
    assert env.client.get("/arbitrator/deals", headers=env.hdr).status_code == 403   # needs admin token
    assert env.get("/arbitrator/deals", admin=True).status_code == 200


def test_kyc_and_gas_drip(env):
    poor = env.poor.address
    r = env.post("/kyc/submit", data={"address": poor, "file": (io.BytesIO(b"passport"), "id.png")}, content_type="multipart/form-data")
    assert r.status_code == 200 and r.json["kyc_level"] == 1
    r = env.post(f"/admin/kyc/{poor}/approve", admin=True)
    assert r.status_code == 200 and r.json["kyc_level"] == 2
    assert r.json["gasDrip"]["dripped"] is True and r.json["txHash"].startswith("0x")
    u = env.get(f"/users/{poor}").json
    assert u["kycOnChain"] and int(u["mstcBalance"]) == Web3.to_wei(0.1, "ether")
    # second approval: no second drip, no second setKyc
    r2 = env.post(f"/admin/kyc/{poor}/approve", admin=True)
    assert r2.json["gasDrip"]["dripped"] is False


def test_happy_path_release_and_indexer(env):
    deal = env.new_accepted_deal()
    env.fund(deal, AMT)
    env.user_send("seller", env.chain.escrow.functions.markDelivered(deal, Web3.keccak(text="work")))
    env.user_send("buyer", env.chain.escrow.functions.release(deal))
    assert env.sync() > 0
    assert env.sync() == 0                      # idempotent
    r = env.get(f"/deals/{deal}").json
    assert r["onchain"]["status"] == "Released"
    assert r["onchain"]["amountFormatted"] == "100"
    names = [e["name"] for e in r["timeline"]]
    assert names[:3] == ["DealProposed", "DealAccepted", "DealFunded"] and "Settled" in names
    assert all(e["explorerUrl"].startswith("https://explorer.test/tx/0x") for e in r["timeline"])
    assert env.usd_bal(env.addr("seller")) == AMT if hasattr(env, "usd_bal") else True
    assert env.chain.usd_balance(env.addr("seller")) == AMT
    listing = env.get(f"/deals?address={env.addr('seller')}&role=seller").json["deals"]
    assert listing[0]["status"] == "Released"


def test_indexer_resumes_after_restart(env):
    deal = env.new_accepted_deal()
    env.sync()
    env.app.extensions["svc"].db.set_meta("last_block", 0)   # simulate lost cursor: full re-scan must not duplicate
    env.sync()
    rows = env.app.extensions["svc"].db.all("SELECT * FROM chain_events WHERE deal_id=?", (deal,))
    assert [r["name"] for r in rows].count("DealProposed") == 1


def test_delivery_upload_hash_and_party_check(env):
    deal = env.new_accepted_deal()
    env.fund(deal, AMT)
    data = b"final-deliverable-bytes"
    r = env.post(f"/deals/{deal}/delivery", data={"address": env.addr("seller"), "file": (io.BytesIO(data), "out.zip")},
                 content_type="multipart/form-data")
    assert r.status_code == 200
    assert r.json["hash"] == "0x" + Web3.keccak(data).hex().removeprefix("0x")
    bad = env.post(f"/deals/{deal}/delivery", data={"address": env.addr("buyer"), "file": (io.BytesIO(data), "x")},
                   content_type="multipart/form-data")
    assert bad.status_code == 403 and bad.json["error"]["code"] == "not_party"


def test_dispute_agent_proposal_then_both_accept(env):
    deal = env.new_accepted_deal()
    env.fund(deal, AMT)
    env.user_send("seller", env.chain.escrow.functions.markDelivered(deal, Web3.keccak(text="work")))
    ev = env.post(f"/deals/{deal}/evidence", data={"address": env.addr("buyer"), "complaint": "Half is missing",
                  "file": (io.BytesIO(b"screenshot"), "s.png")}, content_type="multipart/form-data").json
    env.user_send("buyer", env.chain.escrow.functions.raiseDispute(deal, bytes.fromhex(ev["hash"][2:])))
    r = env.post(f"/deals/{deal}/resolve")
    assert r.status_code == 200, r.json
    assert r.json["stub"] is True and r.json["buyerBps"] == 0     # single-deliverable fallback -> stub scores 100% fulfilled
    env.sync()
    d = env.get(f"/deals/{deal}").json
    assert d["onchain"]["status"] == "ResolutionProposed"
    assert d["reasoning"]["hash"] == r.json["reasoningHash"] == d["onchain"]["reasoningHash"]
    env.user_send("buyer", env.chain.escrow.functions.acceptResolution(deal))
    env.user_send("seller", env.chain.escrow.functions.acceptResolution(deal))
    assert env.get(f"/deals/{deal}").json["onchain"]["status"] == "Resolved"


def test_multi_deliverable_split_uses_formula(env):
    """weights 5000/3000/2000 with stub scores 100/50/0 => buyer gets 0+1500+2000 = 3500 bps (spec example)."""
    deal = env.new_accepted_deal()
    svc = env.app.extensions["svc"]
    sow = {"deliverables": [{"id": "D1", "weightBps": 5000}, {"id": "D2", "weightBps": 3000}, {"id": "D3", "weightBps": 2000}]}
    svc.db.run("INSERT INTO sow_versions(draft_id,version,sow_json,sow_hash) VALUES(1,1,?,?)",
               (json.dumps(sow), "0x" + Web3.keccak(text="sow-v1").hex().removeprefix("0x")))
    assert env.post(f"/deals/{deal}/link-draft", json={"draftId": 1, "version": 1}).status_code == 200
    env.fund(deal, AMT)
    env.user_send("buyer", env.chain.escrow.functions.raiseDispute(deal, Web3.keccak(text="ev")))
    r = env.post(f"/deals/{deal}/resolve").json
    assert r["buyerBps"] == 3500
    assert [s["fulfilledPct"] for s in r["scores"]] == [100, 50, 0]


def test_escalate_and_arbitrate(env):
    deal = env.new_accepted_deal()
    env.fund(deal, AMT)
    env.user_send("buyer", env.chain.escrow.functions.raiseDispute(deal, Web3.keccak(text="ev")))
    env.post(f"/deals/{deal}/resolve")
    env.user_send("seller", env.chain.escrow.functions.escalate(deal))
    env.sync()
    esc = env.get("/arbitrator/deals", admin=True).json["deals"]
    assert [d["id"] for d in esc] == [deal]
    assert env.post(f"/arbitrator/deals/{deal}/rule", admin=True, json={"buyerBps": 20000}).status_code == 400
    r = env.post(f"/arbitrator/deals/{deal}/rule", admin=True, json={"buyerBps": 2500, "rationale": "partial"})
    assert r.status_code == 200
    assert env.chain.usd_balance(env.addr("buyer")) == 25_000_000
    assert env.chain.usd_balance(env.addr("seller")) == 75_000_000
    env.sync()
    d = env.get(f"/deals/{deal}").json
    assert d["onchain"]["status"] == "Resolved" and d["reasoning"]["source"] == "arbitrator"


def test_timeout_flow(env):
    deal = env.new_accepted_deal(review=120)
    env.fund(deal, AMT)
    env.user_send("seller", env.chain.escrow.functions.markDelivered(deal, Web3.keccak(text="work")))
    early = env.post(f"/deals/{deal}/timeout")
    assert early.status_code == 409 and early.json["error"]["code"] == "too_early"
    env.travel(200)
    ok = env.post(f"/deals/{deal}/timeout")
    assert ok.status_code == 200 and ok.json["status"] == "Released"
    assert env.chain.usd_balance(env.addr("seller")) == AMT


def test_revert_mapping(env):
    deal = env.new_accepted_deal()
    # resolve while only Accepted -> our own status guard
    r = env.post(f"/deals/{deal}/resolve")
    assert r.status_code == 409 and r.json["error"]["current_status"] == "Accepted"
    # claimTimeout on an Accepted deal -> BadStatus decoded from the contract
    r = env.post(f"/deals/{deal}/timeout")
    assert r.status_code == 409 and r.json["error"]["code"] == "bad_status"
    assert "Accepted" in r.json["error"]["message"]
    # unknown deal
    assert env.get("/deals/9999").status_code == 404
    # bad address
    assert env.get("/users/not-an-address").status_code == 400


def test_agent_cannot_move_funds_and_scorer_tamper_rejected(env):
    """Even if a scorer lies about the split, B1 recomputes it and refuses."""
    from app import integrations
    ctx = {"dealId": 1, "sow": {"deliverables": [{"id": "D1", "weightBps": 10000}]}, "sowHash": "0x" + "00" * 32,
           "evidenceHash": "0x" + "00" * 32, "deliveryHash": "0x" + "00" * 32}
    good = {"scores": [{"id": "D1", "fulfilledPct": 40}], "buyerBps": 6000, "reasoningHash": "0x" + "11" * 32}
    integrations.requests.post = lambda *a, **k: type("R", (), {"raise_for_status": lambda s: None, "json": lambda s: dict(good)})()
    cfg = type("C", (), {"B2_SCORER_URL": "http://x", "USE_STUB_SCORER": False})
    assert integrations.score_dispute(cfg, ctx)["buyerBps"] == 6000
    good["buyerBps"] = 1
    try:
        integrations.score_dispute(cfg, ctx)
        assert False, "should have raised"
    except Exception as e:
        assert getattr(e, "code", "") == "split_mismatch"


def test_seed_script_creates_four_states(env):
    from scripts.seed import seed
    ids = seed(env.chain, env.app.extensions["svc"].db, env.cfg, env.users["buyer"], env.users["seller"], review=120, log=lambda *_: None)
    env.sync()
    got = {k: env.get(f"/deals/{v}").json for k, v in ids.items()}
    assert {k: v["onchain"]["status"] for k, v in got.items()} == {k: k for k in ids}
    assert got["ResolutionProposed"]["reasoning"]["data"]["buyerBps"] == 3500
    assert len(got["Funded"]["sow"]["deliverables"]) == 3
    assert env.chain.usd_balance(env.chain.escrow_address) == 4 * 100_000_000
