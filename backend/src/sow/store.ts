// B2 storage: SOW drafts + versions + agent call log.
// Lives in the shared SQLite file (env DB_PATH); B2 owns only the tables created here.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type DraftStatus = "awaiting_seller" | "ready_to_merge" | "sow_proposed" | "approved" | "linked";

export type Draft = {
  id: string;
  buyer: string;
  seller: string;
  purpose: string;
  buyerConstraints: string;
  amount: string;
  deliveryDeadline: number;
  reviewWindowSecs: number;
  sellerPoints?: string;
  status: DraftStatus;
  latestSowVersion?: number;
  dealId?: number;
  linkTxHash?: string;
  createdAt: number;
  updatedAt: number;
};

export type SowVersion = {
  draftId: string;
  version: number;
  sowJson: string;
  sowHash: string;
  conflicts: string[];
  buyerApproved: boolean;
  sellerApproved: boolean;
  createdAt: number;
};

export type NewDraft = Pick<
  Draft,
  "buyer" | "seller" | "purpose" | "buyerConstraints" | "amount" | "deliveryDeadline" | "reviewWindowSecs"
>;

export type AgentCall = {
  subject: string; // "draft:<id>" or "deal:<id>"
  kind: string;
  attempt: number;
  provider: string;
  model: string;
  promptVersion: string;
  request: unknown;
  response?: unknown;
  error?: string;
  statusCode?: number | null;
  transient?: boolean;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS drafts (
  id                 TEXT PRIMARY KEY,
  buyer              TEXT NOT NULL,
  seller             TEXT NOT NULL,
  purpose            TEXT NOT NULL,
  buyer_constraints  TEXT NOT NULL,
  amount             TEXT NOT NULL,
  delivery_deadline  INTEGER NOT NULL,
  review_window_secs INTEGER NOT NULL,
  seller_points      TEXT,
  status             TEXT NOT NULL,
  deal_id            INTEGER,
  link_tx_hash       TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_buyer_idx  ON drafts (buyer);
CREATE INDEX IF NOT EXISTS drafts_seller_idx ON drafts (seller);

CREATE TABLE IF NOT EXISTS sow_versions (
  draft_id        TEXT NOT NULL REFERENCES drafts(id),
  version         INTEGER NOT NULL,
  sow_json        TEXT NOT NULL,
  sow_hash        TEXT NOT NULL,
  conflicts_json  TEXT NOT NULL DEFAULT '[]',
  buyer_approved  INTEGER NOT NULL DEFAULT 0,
  seller_approved INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (draft_id, version)
);

-- Audit log of every LLM request/response (API key is never part of the request body).
CREATE TABLE IF NOT EXISTS agent_calls (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  subject        TEXT NOT NULL,
  kind           TEXT NOT NULL,
  attempt        INTEGER NOT NULL,
  provider       TEXT NOT NULL DEFAULT 'unknown',
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  request_json   TEXT NOT NULL,
  response_json  TEXT,
  error          TEXT,
  status_code    INTEGER,
  transient      INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

-- Full reasoning object behind each on-chain reasoningHash (read by /verify).
CREATE TABLE IF NOT EXISTS dispute_rulings (
  reasoning_hash TEXT PRIMARY KEY,
  deal_id        INTEGER NOT NULL,
  reasoning_json TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS dispute_rulings_deal_idx ON dispute_rulings (deal_id);
`;

type DraftRow = {
  id: string;
  buyer: string;
  seller: string;
  purpose: string;
  buyer_constraints: string;
  amount: string;
  delivery_deadline: number;
  review_window_secs: number;
  seller_points: string | null;
  status: DraftStatus;
  deal_id: number | null;
  link_tx_hash: string | null;
  created_at: number;
  updated_at: number;
  latest_version: number | null;
};

type VersionRow = {
  draft_id: string;
  version: number;
  sow_json: string;
  sow_hash: string;
  conflicts_json: string;
  buyer_approved: number;
  seller_approved: number;
  created_at: number;
};

export class SowStore {
  readonly db: Database.Database;

  /** Pass a path (defaults to env DB_PATH or ./data/app.sqlite), ":memory:", or B1's open connection. */
  constructor(dbOrPath: Database.Database | string = process.env.DB_PATH || "./data/app.sqlite") {
    if (typeof dbOrPath === "string") {
      if (dbOrPath !== ":memory:") mkdirSync(dirname(dbOrPath), { recursive: true });
      this.db = new Database(dbOrPath);
      this.db.pragma("journal_mode = WAL");
    } else {
      this.db = dbOrPath;
    }
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA);
    // Older local DBs created agent_calls before these columns existed.
    const cols = new Set((this.db.prepare(`PRAGMA table_info(agent_calls)`).all() as { name: string }[]).map((c) => c.name));
    const added: [string, string][] = [
      ["provider", "TEXT NOT NULL DEFAULT 'unknown'"],
      ["status_code", "INTEGER"],
      ["transient", "INTEGER NOT NULL DEFAULT 0"],
    ];
    for (const [name, type] of added) if (!cols.has(name)) this.db.exec(`ALTER TABLE agent_calls ADD COLUMN ${name} ${type}`);
  }

  createDraft(input: NewDraft, now: number): Draft {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO drafts (id, buyer, seller, purpose, buyer_constraints, amount, delivery_deadline,
           review_window_secs, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'awaiting_seller', ?, ?)`,
      )
      .run(
        id,
        input.buyer,
        input.seller,
        input.purpose,
        input.buyerConstraints,
        input.amount,
        input.deliveryDeadline,
        input.reviewWindowSecs,
        now,
        now,
      );
    return this.getDraft(id)!;
  }

  getDraft(id: string): Draft | undefined {
    const row = this.db
      .prepare(
        `SELECT d.*, (SELECT MAX(version) FROM sow_versions v WHERE v.draft_id = d.id) AS latest_version
         FROM drafts d WHERE d.id = ?`,
      )
      .get(id) as DraftRow | undefined;
    return row && toDraft(row);
  }

  setSellerPoints(id: string, sellerPoints: string, now: number): Draft {
    this.db
      .prepare(`UPDATE drafts SET seller_points = ?, status = 'ready_to_merge', updated_at = ? WHERE id = ?`)
      .run(sellerPoints, now, id);
    return this.getDraft(id)!;
  }

  /** Stores a new SOW version with both approvals reset. */
  addVersion(draftId: string, sowJson: string, sowHash: string, conflicts: string[], now: number): SowVersion {
    const tx = this.db.transaction(() => {
      const { next } = this.db
        .prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM sow_versions WHERE draft_id = ?`)
        .get(draftId) as { next: number };
      this.db
        .prepare(
          `INSERT INTO sow_versions (draft_id, version, sow_json, sow_hash, conflicts_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(draftId, next, sowJson, sowHash, JSON.stringify(conflicts), now);
      this.db.prepare(`UPDATE drafts SET status = 'sow_proposed', updated_at = ? WHERE id = ?`).run(now, draftId);
      return next;
    });
    return this.getVersion(draftId, tx())!;
  }

  getVersion(draftId: string, version: number): SowVersion | undefined {
    const row = this.db
      .prepare(`SELECT * FROM sow_versions WHERE draft_id = ? AND version = ?`)
      .get(draftId, version) as VersionRow | undefined;
    return row && toVersion(row);
  }

  getLatestVersion(draftId: string): SowVersion | undefined {
    const row = this.db
      .prepare(`SELECT * FROM sow_versions WHERE draft_id = ? ORDER BY version DESC LIMIT 1`)
      .get(draftId) as VersionRow | undefined;
    return row && toVersion(row);
  }

  approve(draftId: string, version: number, party: "buyer" | "seller", now: number): SowVersion {
    const col = party === "buyer" ? "buyer_approved" : "seller_approved";
    this.db.prepare(`UPDATE sow_versions SET ${col} = 1 WHERE draft_id = ? AND version = ?`).run(draftId, version);
    this.db.prepare(`UPDATE drafts SET updated_at = ? WHERE id = ?`).run(now, draftId);
    return this.getVersion(draftId, version)!;
  }

  updateTerms(id: string, t: { amount: string; deliveryDeadline: number; reviewWindowSecs: number }, now: number): void {
    this.db
      .prepare(`UPDATE drafts SET amount = ?, delivery_deadline = ?, review_window_secs = ?, updated_at = ? WHERE id = ?`)
      .run(t.amount, t.deliveryDeadline, t.reviewWindowSecs, now, id);
  }

  setStatus(draftId: string, status: DraftStatus, now: number): void {
    this.db.prepare(`UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, draftId);
  }

  link(draftId: string, dealId: number, txHash: string, now: number): Draft {
    this.db
      .prepare(`UPDATE drafts SET deal_id = ?, link_tx_hash = ?, status = 'linked', updated_at = ? WHERE id = ?`)
      .run(dealId, txHash, now, draftId);
    return this.getDraft(draftId)!;
  }

  logAgentCall(call: AgentCall, now: number): void {
    this.db
      .prepare(
        `INSERT INTO agent_calls (subject, kind, attempt, provider, model, prompt_version, request_json, response_json, error, status_code, transient, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        call.subject,
        call.kind,
        call.attempt,
        call.provider,
        call.model,
        call.promptVersion,
        JSON.stringify(call.request),
        call.response === undefined ? null : JSON.stringify(call.response),
        call.error ?? null,
        call.statusCode ?? null,
        call.transient ? 1 : 0,
        now,
      );
  }

  /** The approved SOW of the draft linked to an on-chain deal id (latest version; linked drafts can't change). */
  getSowForDeal(dealId: number): { draftId: string; sowJson: string; sowHash: string } | undefined {
    const row = this.db
      .prepare(
        `SELECT v.draft_id, v.sow_json, v.sow_hash FROM drafts d JOIN sow_versions v ON v.draft_id = d.id
         WHERE d.deal_id = ? AND d.status = 'linked' ORDER BY v.version DESC LIMIT 1`,
      )
      .get(dealId) as { draft_id: string; sow_json: string; sow_hash: string } | undefined;
    return row && { draftId: row.draft_id, sowJson: row.sow_json, sowHash: row.sow_hash };
  }

  /** Idempotent: the same reasoning always has the same hash. */
  saveRuling(reasoningHash: string, dealId: number, reasoning: unknown, now: number): void {
    this.db
      .prepare(`INSERT OR IGNORE INTO dispute_rulings (reasoning_hash, deal_id, reasoning_json, created_at) VALUES (?, ?, ?, ?)`)
      .run(reasoningHash, dealId, JSON.stringify(reasoning), now);
  }

  getRuling(reasoningHash: string): unknown | undefined {
    const row = this.db.prepare(`SELECT reasoning_json FROM dispute_rulings WHERE reasoning_hash = ?`).get(reasoningHash) as
      | { reasoning_json: string }
      | undefined;
    return row && JSON.parse(row.reasoning_json);
  }
}

function toDraft(r: DraftRow): Draft {
  return {
    id: r.id,
    buyer: r.buyer,
    seller: r.seller,
    purpose: r.purpose,
    buyerConstraints: r.buyer_constraints,
    amount: r.amount,
    deliveryDeadline: r.delivery_deadline,
    reviewWindowSecs: r.review_window_secs,
    ...(r.seller_points !== null && { sellerPoints: r.seller_points }),
    status: r.status,
    ...(r.latest_version !== null && { latestSowVersion: r.latest_version }),
    ...(r.deal_id !== null && { dealId: r.deal_id }),
    ...(r.link_tx_hash !== null && { linkTxHash: r.link_tx_hash }),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function toVersion(r: VersionRow): SowVersion {
  return {
    draftId: r.draft_id,
    version: r.version,
    sowJson: r.sow_json,
    sowHash: r.sow_hash,
    conflicts: JSON.parse(r.conflicts_json) as string[],
    buyerApproved: r.buyer_approved === 1,
    sellerApproved: r.seller_approved === 1,
    createdAt: r.created_at,
  };
}
