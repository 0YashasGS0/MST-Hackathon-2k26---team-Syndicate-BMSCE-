import json
import time

from flask import Blueprint, current_app, jsonify, request

from . import integrations
from .chain import STATUS, ck
from .errors import ApiError
from .util import fmt_units, hash_json, save_uploads

bp = Blueprint("api", __name__)
FUNDED_STATES = {"Funded", "Delivered", "Disputed", "ResolutionProposed", "Escalated"}


def S():
    return current_app.extensions["svc"]


def tx_url(h):
    e = S().cfg.EXPLORER_URL
    return f"{e}/tx/{h}" if e else None


def addr_url(a):
    e = S().cfg.EXPLORER_URL
    return f"{e}/address/{a}" if e else None


def body():
    return request.get_json(silent=True) or {}


def need_deal(deal_id):
    d = S().chain.get_deal(deal_id)
    if d is None:
        raise ApiError("deal_not_found", f"Deal {deal_id} does not exist on-chain.", 404)
    return d


def serialize_deal(d):
    dec = 6
    out = {k: (str(v) if isinstance(v, int) and not isinstance(v, bool) and k in ("amount",) else v) for k, v in d.items()}
    out["amountFormatted"] = fmt_units(d["amount"], dec)
    out["proposedBuyerBps"] = d["proposedBuyerBps"]
    out["reviewEndsAt"] = d["deliveredAt"] + d["reviewPeriod"] if d["deliveredAt"] else None
    out["escrowBalance"] = str(d["amount"] if d["status"] in FUNDED_STATES else 0)
    out["escrowBalanceFormatted"] = fmt_units(d["amount"] if d["status"] in FUNDED_STATES else 0, dec)
    return out


def timeline(deal_id):
    rows = S().db.all("SELECT * FROM chain_events WHERE deal_id=? ORDER BY block, log_index", (deal_id,))
    out = []
    for r in rows:
        args = json.loads(r["args_json"])
        out.append({"name": r["name"], "args": args, "actor": args.get("by") or args.get("buyer") or args.get("funder"),
                    "txHash": r["tx_hash"], "block": r["block"], "timestamp": r["block_ts"],
                    "explorerUrl": tx_url(r["tx_hash"])})
    return out


def check_party(deal, address, allowed):
    a = ck(address)
    roles = {"buyer": deal["buyer"], "seller": deal["seller"]}
    if a not in [roles[r] for r in allowed]:
        raise ApiError("not_party", f"Address is not the {' or '.join(allowed)} of this deal.", 403)
    return a


# ------------------------------------------------------------------ public info
@bp.get("/health")
def health():
    s = S()
    return jsonify({"ok": True, "chain": s.chain.health(), "escrowConfigured": bool(s.chain.escrow),
                    "indexer": {"lastBlock": s.db.get_meta("last_block"), "lastError": s.indexer.last_error}})


@bp.get("/config")
def config():
    s = S()
    return jsonify({"chainId": s.cfg.CHAIN_ID, "rpcUrl": s.cfg.MST_RPC_URL, "explorerUrl": s.cfg.EXPLORER_URL or None,
                    "escrowAddress": s.chain.escrow_address, "usdAddress": s.chain.usd_address,
                    "usdDecimals": 6, "nativeSymbol": "MSTC",
                    "systemWallets": {r: s.chain.address_of(r) for r in ("org", "agent", "arbitrator")},
                    "statuses": STATUS})


@bp.get("/contracts/abi")
def abi():
    s = S()
    return jsonify({"DealEscrow": s.chain.escrow_abi, "MockUSD": s.chain.usd_abi})


# ------------------------------------------------------------------------ users / KYC
@bp.get("/users/<address>")
def get_user(address):
    s, a = S(), ck(address)
    u = s.db.one("SELECT * FROM users WHERE address=?", (a,)) or {"address": a, "kyc_level": 0}
    onchain = s.chain.is_kyc(a) if s.chain.escrow else False
    return jsonify({**u, "kycOnChain": onchain,
                    "kycTxUrl": tx_url(u.get("kyc_tx")) if u.get("kyc_tx") else None,
                    "mstcBalance": str(s.chain.native_balance(a)),
                    "musdBalance": str(s.chain.usd_balance(a)),
                    "musdBalanceFormatted": fmt_units(s.chain.usd_balance(a))})


@bp.post("/users")
def upsert_user():
    """Called by the frontend / PG's /auth/saral after login. Never lowers kyc_level."""
    s, b = S(), body()
    a = ck(b.get("address", ""))
    s.db.run("""INSERT INTO users(address,handle,saral_id,kyc_level) VALUES(?,?,?,?)
                ON CONFLICT(address) DO UPDATE SET handle=COALESCE(excluded.handle,handle),
                saral_id=COALESCE(excluded.saral_id,saral_id), kyc_level=MAX(kyc_level,excluded.kyc_level)""",
             (a, b.get("handle"), b.get("saralId"), int(b.get("kycLevel", 0))))
    return jsonify(s.db.one("SELECT * FROM users WHERE address=?", (a,)))


@bp.post("/kyc/submit")
def kyc_submit():
    s = S()
    a = ck(request.form.get("address", ""))
    files = request.files.getlist("file")
    if not files:
        raise ApiError("no_file", "Upload a document in the 'file' field.", 400)
    save_uploads(s.cfg, s.db, "kyc", None, a, files)
    s.db.run("""INSERT INTO users(address,kyc_level) VALUES(?,1)
                ON CONFLICT(address) DO UPDATE SET kyc_level=MAX(kyc_level,1)""", (a,))
    return jsonify({"address": a, "kyc_level": s.db.one("SELECT kyc_level FROM users WHERE address=?", (a,))["kyc_level"],
                    "status": "pending_review"})


@bp.post("/admin/kyc/<address>/approve")
def kyc_approve(address):
    s, a = S(), ck(address)
    s.chain.require_ready()
    if s.chain.is_kyc(a):
        tx = {"tx_hash": (s.db.one("SELECT kyc_tx FROM users WHERE address=?", (a,)) or {}).get("kyc_tx"), "already": True}
    else:
        tx = s.chain.send("org", s.chain.escrow.functions.setKyc(a, True))
    s.db.run("""INSERT INTO users(address,kyc_level,kyc_tx) VALUES(?,2,?)
                ON CONFLICT(address) DO UPDATE SET kyc_level=2, kyc_tx=COALESCE(?, kyc_tx)""",
             (a, tx.get("tx_hash"), tx.get("tx_hash")))
    try:
        drip = integrations.gas_drip(s.chain, s.db, s.cfg, a)
    except Exception as e:  # KYC must not fail because the drip did
        drip = {"dripped": False, "reason": "error", "detail": str(e)[:120]}
    return jsonify({"address": a, "kyc_level": 2, "txHash": tx.get("tx_hash"),
                    "explorerUrl": tx_url(tx["tx_hash"]) if tx.get("tx_hash") else None, "gasDrip": drip})


# ----------------------------------------------------------------------------- deals
@bp.get("/deals")
def list_deals():
    s = S()
    address, role = request.args.get("address"), request.args.get("role")
    q, args = "SELECT * FROM deals", []
    if address:
        a = ck(address)
        if role == "buyer":
            q, args = q + " WHERE buyer=?", [a]
        elif role == "seller":
            q, args = q + " WHERE seller=?", [a]
        else:
            q, args = q + " WHERE buyer=? OR seller=?", [a, a]
    rows = s.db.all(q + " ORDER BY id DESC", args)
    for r in rows:
        r["amountFormatted"] = fmt_units(r["amount"] or 0)
    return jsonify({"deals": rows})


@bp.get("/deals/<int:deal_id>")
def get_deal(deal_id):
    """Chain is the source of truth for status/amounts; DB adds text, files, events."""
    s = S()
    d = need_deal(deal_id)
    row = s.db.one("SELECT * FROM deals WHERE id=?", (deal_id,)) or {}
    sow = None
    if row.get("draft_id") is not None:
        v = s.db.one("SELECT * FROM sow_versions WHERE draft_id=? AND sow_hash=?", (row["draft_id"], d["sowHash"]))
        sow = json.loads(v["sow_json"]) if v else None
    reasoning = None
    if int(d["reasoningHash"], 16):
        r = s.db.one("SELECT * FROM reasonings WHERE hash=?", (d["reasoningHash"],))
        reasoning = {"hash": d["reasoningHash"], "source": r["source"], "data": json.loads(r["json"])} if r else {"hash": d["reasoningHash"]}
    subs = s.db.all("SELECT kind,address,note,bundle_hash,created_at FROM submissions WHERE deal_id=? ORDER BY created_at", (deal_id,))
    files = s.db.all("SELECT kind,address,name,keccak,bundle_hash,created_at FROM files WHERE deal_id=?", (deal_id,))
    return jsonify({"id": deal_id, "draftId": row.get("draft_id"), "onchain": serialize_deal(d), "sow": sow,
                    "reasoning": reasoning, "timeline": timeline(deal_id), "submissions": subs, "files": files,
                    "escrowUrl": addr_url(s.chain.escrow_address)})


@bp.get("/deals/<int:deal_id>/events")
def deal_events(deal_id):
    return jsonify({"events": timeline(deal_id)})


@bp.post("/deals/<int:deal_id>/link-draft")
def link_draft(deal_id):
    """FE calls this after the buyer's proposeDeal receipt so the deal row knows its SOW draft."""
    s, b = S(), body()
    d = need_deal(deal_id)
    draft_id = b.get("draftId")
    if draft_id is None:
        raise ApiError("bad_request", "draftId is required", 400)
    s.db.run("""INSERT INTO deals(id,buyer,seller,amount,status,sow_hash,draft_id,sow_version) VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(id) DO UPDATE SET draft_id=excluded.draft_id, sow_version=excluded.sow_version""",
             (deal_id, d["buyer"], d["seller"], str(d["amount"]), d["status"], d["sowHash"], int(draft_id), b.get("version")))
    return jsonify({"id": deal_id, "draftId": int(draft_id)})


def _upload(kind, deal_id, allowed_roles):
    s = S()
    d = need_deal(deal_id)
    a = check_party(d, request.form.get("address", ""), allowed_roles)
    note = request.form.get("note") or request.form.get("complaint") or None
    rows, bundle = save_uploads(s.cfg, s.db, kind, deal_id, a, request.files.getlist("file"), note)
    s.db.run("INSERT OR IGNORE INTO submissions(deal_id,kind,address,note,bundle_hash,created_at) VALUES(?,?,?,?,?,?)",
             (deal_id, kind, a, note, bundle, int(time.time())))
    return jsonify({"hash": bundle, "files": [{"name": r["name"], "keccak": r["keccak"]} for r in rows],
                    "next": "Sign markDelivered(id, hash) from the seller wallet" if kind == "delivery"
                    else "Sign raiseDispute(id, hash) from the buyer/seller wallet, then POST /deals/<id>/resolve"})


@bp.post("/deals/<int:deal_id>/delivery")
def upload_delivery(deal_id):
    return _upload("delivery", deal_id, ["seller"])


@bp.post("/deals/<int:deal_id>/evidence")
def upload_evidence(deal_id):
    return _upload("evidence", deal_id, ["buyer", "seller"])


@bp.post("/deals/<int:deal_id>/resolve")
def resolve(deal_id):
    """Agent scores the dispute (B2) -> deterministic split -> agent wallet PROPOSES on-chain."""
    s = S()
    d = need_deal(deal_id)
    if d["status"] not in ("Disputed", "ResolutionProposed"):
        raise ApiError("bad_status", f"Deal must be Disputed to resolve. Current status: {d['status']}.", 409,
                       current_status=d["status"])
    row = s.db.one("SELECT * FROM deals WHERE id=?", (deal_id,)) or {}
    sow = {"deliverables": integrations.SINGLE_DELIVERABLE, "note": "no SOW linked; single deliverable fallback"}
    if row.get("draft_id") is not None:
        v = s.db.one("SELECT sow_json FROM sow_versions WHERE draft_id=? AND sow_hash=?", (row["draft_id"], d["sowHash"]))
        if v:
            sow = json.loads(v["sow_json"])

    def latest(kind, h):
        r = s.db.one("SELECT * FROM submissions WHERE deal_id=? AND kind=? AND bundle_hash=?", (deal_id, kind, h)) or \
            s.db.one("SELECT * FROM submissions WHERE deal_id=? AND kind=? ORDER BY created_at DESC LIMIT 1", (deal_id, kind))
        fl = s.db.all("SELECT name,keccak FROM files WHERE deal_id=? AND kind=?", (deal_id, kind))
        return {"note": r["note"] if r else None, "bundleHash": r["bundle_hash"] if r else h, "files": fl}

    ctx = {"dealId": deal_id, "sowHash": d["sowHash"], "sow": sow,
           "delivery": latest("delivery", d["deliveryHash"]), "evidence": latest("evidence", d["evidenceHash"]),
           "deliveryHash": d["deliveryHash"], "evidenceHash": d["evidenceHash"]}
    out = integrations.score_dispute(s.cfg, ctx)
    s.db.run("INSERT INTO llm_log(deal_id,kind,request_json,response_json) VALUES(?,?,?,?)",
             (deal_id, "score", json.dumps(ctx), json.dumps(out)))
    s.db.run("INSERT OR REPLACE INTO reasonings(hash,json,source,created_at) VALUES(?,?,?,?)",
             (out["reasoningHash"], json.dumps(out.get("reasoning") or {"scores": out["scores"], "buyerBps": out["buyerBps"]}),
              "agent-stub" if (out.get("reasoning") or {}).get("stub") else "agent", int(time.time())))
    tx = s.chain.send("agent", s.chain.escrow.functions.proposeResolution(
        deal_id, out["buyerBps"], bytes.fromhex(out["reasoningHash"][2:])))
    return jsonify({"scores": out["scores"], "buyerBps": out["buyerBps"], "reasoningHash": out["reasoningHash"],
                    "stub": bool((out.get("reasoning") or {}).get("stub")),
                    "txHash": tx["tx_hash"], "explorerUrl": tx_url(tx["tx_hash"])})


@bp.post("/deals/<int:deal_id>/timeout")
def timeout(deal_id):
    """Anyone may call claimTimeout; recipients are fixed by the contract. ORG wallet pays the gas."""
    s = S()
    need_deal(deal_id)
    tx = s.chain.send("org", s.chain.escrow.functions.claimTimeout(deal_id))
    return jsonify({"txHash": tx["tx_hash"], "explorerUrl": tx_url(tx["tx_hash"]),
                    "status": s.chain.get_deal(deal_id)["status"]})


# ------------------------------------------------------------------------ arbitrator
@bp.get("/arbitrator/deals")
def arbitrator_list():
    s = S()
    rows = s.db.all("SELECT * FROM deals WHERE status='Escalated' ORDER BY id DESC")
    return jsonify({"deals": [{**r, "amountFormatted": fmt_units(r["amount"] or 0)} for r in rows]})


@bp.post("/arbitrator/deals/<int:deal_id>/rule")
def arbitrator_rule(deal_id):
    s, b = S(), body()
    d = need_deal(deal_id)
    bps = b.get("buyerBps")
    if not isinstance(bps, int) or isinstance(bps, bool) or not 0 <= bps <= 10000:
        raise ApiError("bad_request", "buyerBps must be an integer 0-10000.", 400)
    ruling = {"dealId": deal_id, "buyerBps": bps, "rationale": str(b.get("rationale", ""))[:2000],
              "sowHash": d["sowHash"], "ruledAt": int(time.time())}
    h = hash_json(ruling)
    s.db.run("INSERT OR REPLACE INTO reasonings(hash,json,source,created_at) VALUES(?,?,?,?)",
             (h, json.dumps(ruling), "arbitrator", int(time.time())))
    tx = s.chain.send("arbitrator", s.chain.escrow.functions.arbitrate(deal_id, bps, bytes.fromhex(h[2:])))
    return jsonify({"txHash": tx["tx_hash"], "explorerUrl": tx_url(tx["tx_hash"]), "reasoningHash": h})
