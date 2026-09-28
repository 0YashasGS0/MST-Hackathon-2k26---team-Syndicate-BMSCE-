import json
import os
import re
import uuid

from web3 import Web3

from .errors import ApiError


def canonical_json(o) -> str:
    """RFC 8785-compatible for our data (strings/ints/bools/null/lists/objects; no floats)."""
    return json.dumps(o, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def hash_json(o) -> str:
    return "0x" + Web3.keccak(text=canonical_json(o)).hex().removeprefix("0x")


def keccak_bytes(b: bytes) -> str:
    return "0x" + Web3.keccak(b).hex().removeprefix("0x")


def fmt_units(x, decimals=6) -> str:
    x = int(x)
    whole, frac = divmod(x, 10 ** decimals)
    return f"{whole}.{str(frac).zfill(decimals)}".rstrip("0").rstrip(".") if frac else str(whole)


def safe_name(name: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]", "_", os.path.basename(name or "file"))[:80] or "file"


def save_uploads(cfg, db, kind, deal_id, address, files, note=None):
    """Persist uploaded files; return (stored_rows, bundle_hash).

    bundle_hash rules (documented in API.md so anyone can recompute it):
      * exactly one file and no note  -> keccak256(file bytes)
      * otherwise -> keccak256(canonical_json({"note": note, "files": [{"name","keccak"}...]}))
        with files sorted by keccak.
    """
    if not files and not note:
        raise ApiError("empty_submission", "Attach at least one file or a text note.", 400)
    folder = os.path.join(cfg.UPLOAD_DIR, kind, str(deal_id if deal_id is not None else "none"))
    os.makedirs(folder, exist_ok=True)
    rows = []
    for f in files:
        data = f.read()
        if len(data) > cfg.MAX_UPLOAD_BYTES:
            raise ApiError("file_too_large", f"{f.filename} exceeds {cfg.MAX_UPLOAD_BYTES // 1024 // 1024} MB", 413)
        h = keccak_bytes(data)
        path = os.path.join(folder, f"{uuid.uuid4().hex[:8]}_{safe_name(f.filename)}")
        with open(path, "wb") as out:
            out.write(data)
        rows.append({"name": safe_name(f.filename), "path": path, "keccak": h})
    if len(rows) == 1 and not note:
        bundle = rows[0]["keccak"]
    else:
        bundle = hash_json({"note": note or "", "files": sorted(({"name": r["name"], "keccak": r["keccak"]} for r in rows),
                                                                 key=lambda r: r["keccak"])})
    for r in rows:
        db.run("INSERT INTO files(deal_id,address,kind,name,path,keccak,bundle_hash) VALUES(?,?,?,?,?,?,?)",
               (deal_id, address, kind, r["name"], r["path"], r["keccak"], bundle))
    return rows, bundle
