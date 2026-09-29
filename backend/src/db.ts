// SQLite schema. Shared by every role's routes (kyc, deals, resolve, payments).
// The chain is the source of truth for status/amounts; SQLite is only for
// text, files and things that never went on-chain.
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, "app.db");
export const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  address TEXT PRIMARY KEY,
  handle TEXT,
  kyc_level INTEGER DEFAULT 0,
  saral_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS deals (
  id INTEGER PRIMARY KEY,          -- on-chain deal id
  draft_id INTEGER,
  buyer TEXT,
  seller TEXT,
  amount TEXT,
  status TEXT,
  sow_version INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER,
  kind TEXT,               -- delivery | evidence | kyc
  path TEXT,
  keccak TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chain_events (
  tx_hash TEXT,
  log_index INTEGER,
  deal_id INTEGER,
  name TEXT,
  args_json TEXT,
  block INTEGER,
  PRIMARY KEY (tx_hash, log_index)
);

-- Hour 5-8: full agent/arbitrator reasoning, keyed by the on-chain reasoningHash
-- so the verify page (FE) can fetch and recompute it. See docs §2 "reasoningHash".
CREATE TABLE IF NOT EXISTS resolutions (
  reasoning_hash TEXT PRIMARY KEY,
  deal_id INTEGER,
  kind TEXT,                -- 'agent' | 'arbitrator'
  buyer_bps INTEGER,
  payload_json TEXT,        -- { scores, buyerBps, model, promptVersion, evidenceHash, deliveryHash }
  tx_hash TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- PG-owned (same definitions as backend/src/payments/schema.sql); created here too because the indexer writes payouts.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER UNIQUE,
  amount TEXT NOT NULL, -- MockUSD base units (6 decimals)
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'minted', 'funded', 'failed')),
  method TEXT CHECK (method IN ('upi_qr', 'upi_id', 'upi_app', 'crypto')),
  mint_tx TEXT,
  fund_tx TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS payouts (
  deal_id INTEGER PRIMARY KEY,
  to_buyer TEXT,
  to_seller TEXT,
  final_status TEXT,
  tx_hash TEXT
);

-- Notes the parties typed with a delivery or a complaint (the files themselves are in "files").
CREATE TABLE IF NOT EXISTS deal_notes (
  deal_id    INTEGER NOT NULL,
  kind       TEXT NOT NULL,          -- delivery | evidence
  note       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (deal_id, kind)
);

-- The complaint behind a dispute (what the agent and the arbitrator read). One per deal.
CREATE TABLE IF NOT EXISTS complaints (
  deal_id              INTEGER PRIMARY KEY,
  raised_by            TEXT NOT NULL,   -- buyer | seller
  text                 TEXT NOT NULL,
  deliverable_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at           INTEGER NOT NULL
);
`);

// Columns added after the first schema (older local DBs get them here).
const fileCols = new Set((db.prepare("PRAGMA table_info(files)").all() as { name: string }[]).map((c) => c.name));
for (const [name, type] of [["name", "TEXT"], ["mime", "TEXT"], ["size", "INTEGER"]] as const) {
  if (!fileCols.has(name)) db.exec(`ALTER TABLE files ADD COLUMN ${name} ${type}`);
}
