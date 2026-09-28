-- PG-owned tables for B1's shared better-sqlite3 database.
-- The payments/payouts definitions must stay compatible with backend/src/db.ts.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER UNIQUE,
  amount TEXT NOT NULL, -- MockUSD base units (6 decimals)
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'paid', 'minted', 'funded', 'failed')),
  mint_tx TEXT,
  fund_tx TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- B1's event indexer fills payouts from Settled events.
CREATE TABLE IF NOT EXISTS payouts (
  deal_id INTEGER PRIMARY KEY,
  to_buyer TEXT,
  to_seller TEXT,
  final_status TEXT,
  tx_hash TEXT
);

-- Separate from users so PG does not alter B1's users-table schema.
CREATE TABLE IF NOT EXISTS gas_drips (
  address TEXT PRIMARY KEY COLLATE NOCASE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  tx_hash TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Short claim leases prevent concurrent confirms and allow recovery after a
-- process exits while a payment is in progress.
CREATE TABLE IF NOT EXISTS payment_claims (
  deal_id INTEGER PRIMARY KEY,
  claimed_until INTEGER NOT NULL
);

-- Single active sign-in challenge per wallet; consuming deletes it atomically.
CREATE TABLE IF NOT EXISTS auth_nonces (
  address TEXT PRIMARY KEY COLLATE NOCASE,
  nonce TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);
