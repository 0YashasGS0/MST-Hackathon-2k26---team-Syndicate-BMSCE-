import os
import sqlite3
from contextlib import contextmanager

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  address TEXT PRIMARY KEY, handle TEXT, kyc_level INTEGER NOT NULL DEFAULT 0,
  saral_id TEXT, kyc_tx TEXT, gas_dripped INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
CREATE TABLE IF NOT EXISTS deals(
  id INTEGER PRIMARY KEY,            -- = on-chain deal id
  draft_id INTEGER, buyer TEXT, seller TEXT, amount TEXT, status TEXT, sow_hash TEXT,
  sow_version INTEGER, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
-- drafts + sow_versions: tables live here, the endpoints are owned by B2
CREATE TABLE IF NOT EXISTS drafts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, buyer TEXT, seller TEXT, purpose TEXT, price TEXT,
  buyer_constraints TEXT, seller_points TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS sow_versions(
  draft_id INTEGER, version INTEGER, sow_json TEXT, sow_hash TEXT,
  buyer_approved INTEGER DEFAULT 0, seller_approved INTEGER DEFAULT 0,
  PRIMARY KEY(draft_id, version));
CREATE TABLE IF NOT EXISTS files(
  id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, address TEXT,
  kind TEXT CHECK(kind IN ('delivery','evidence','kyc')), name TEXT, path TEXT, keccak TEXT,
  bundle_hash TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
CREATE TABLE IF NOT EXISTS submissions(   -- note text + bundle hash for delivery / evidence
  deal_id INTEGER, kind TEXT, address TEXT, note TEXT, bundle_hash TEXT, created_at INTEGER,
  PRIMARY KEY(deal_id, kind, bundle_hash));
CREATE TABLE IF NOT EXISTS chain_events(
  tx_hash TEXT, log_index INTEGER, deal_id INTEGER, name TEXT, args_json TEXT,
  block INTEGER, block_ts INTEGER, PRIMARY KEY(tx_hash, log_index));
CREATE INDEX IF NOT EXISTS ix_events_deal ON chain_events(deal_id, block, log_index);
CREATE TABLE IF NOT EXISTS reasonings(hash TEXT PRIMARY KEY, json TEXT, source TEXT, created_at INTEGER);
CREATE TABLE IF NOT EXISTS llm_log(id INTEGER PRIMARY KEY AUTOINCREMENT, deal_id INTEGER, kind TEXT,
  request_json TEXT, response_json TEXT, created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')));
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
"""


class Database:
    def __init__(self, path: str):
        self.path = path
        if path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        with self.conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def conn(self):
        c = sqlite3.connect(self.path, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        try:
            yield c
            c.commit()
        finally:
            c.close()

    def one(self, sql, args=()):
        with self.conn() as c:
            r = c.execute(sql, args).fetchone()
            return dict(r) if r else None

    def all(self, sql, args=()):
        with self.conn() as c:
            return [dict(r) for r in c.execute(sql, args).fetchall()]

    def run(self, sql, args=()):
        with self.conn() as c:
            return c.execute(sql, args).lastrowid

    def get_meta(self, k, default=None):
        r = self.one("SELECT v FROM meta WHERE k=?", (k,))
        return r["v"] if r else default

    def set_meta(self, k, v):
        self.run("INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v", (k, str(v)))
