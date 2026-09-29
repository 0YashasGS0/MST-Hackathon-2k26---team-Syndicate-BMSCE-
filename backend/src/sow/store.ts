// B2 storage: SOW drafts + versions + agent call log + dispute rulings.
// Lives in the shared SQLite file (env DB_PATH, or B1's open connection); B2 owns ONLY the tables created here:
// drafts, sow_versions, agent_calls, dispute_rulings.
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { hashJson, parseSow, TOTAL_BPS, type AnyReasoning, type Sow } from "@kernel-exploits/shared";

export type Party = "buyer" | "seller";

/**
 * Internal lifecycle stage (the `drafts.status` column). The API's FE-facing `status` is derived from it
 * (see publicStatus in views.ts). "awaiting_seller" is the pre-merge-plan name of "awaiting_other" (old rows).
 */
export type DraftStatus = "awaiting_other" | "awaiting_seller" | "ready_to_merge" | "sow_proposed" | "approved" | "linked";

export type Draft = {
  id: string;
  /** The side that created the draft; the other side adds its terms with POST /drafts/:id/terms. */
  initiator: Party;
  buyer: string;
  seller: string;
  purpose: string;
  buyerConstraints?: string; // the buyer's terms (absent until the buyer gives them)
  amount: string;
  deliveryDeadline: number;
  reviewWindowSecs: number;
  sellerPoints?: string; // the seller's terms
  status: DraftStatus;
  latestSowVersion?: number;
  dealId?: number;
  linkTxHash?: string;
  createdAt: number;
  updatedAt: number;
};

/** A structured, resolvable disagreement (FE `Conflict`). Only deliveryDeadline for now; times are unix seconds. */
export type Conflict = {
  field: "deliveryDeadline";
  label: string;
  buyerWants: number;
  sellerWants: number;
  proposals: { buyer?: number; seller?: number };
};

/** A party's signature over the version's sowHash (signMessage({ message: { raw: sowHash } })). */
export type Signature = { party: Party; signer: string; signature: string; signedAt: number };

export type StoredSowVersion = {
  draftId: string;
  version: number;
  sowJson: string;
  sowHash: string;
  /** Free-text conflicts from the agent plus "[server] …" notes. */
  conflictNotes: string[];
  /** Structured conflicts; approval is blocked while any is present on the latest version. */
  conflicts: Conflict[];
  signatures: Signature[];
  buyerApproved: boolean;
  sellerApproved: boolean;
  createdAt: number;
};

export type NewDraft = Pick<Draft, "buyer" | "seller" | "purpose" | "amount" | "deliveryDeadline" | "reviewWindowSecs"> & {
  initiator?: Party; // default "buyer"
  buyerConstraints?: string;
  sellerPoints?: string;
};

/** What getSowForDeal returns: the agreed (latest) SOW of the draft linked to an on-chain deal. */
export type DealSow = { sow: Sow; sowHash: string; draftId: string; version: number };

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
  retryDelayMs?: number;
  toolMode?: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS drafts (
  id                 TEXT PRIMARY KEY,
  initiator          TEXT NOT NULL DEFAULT 'buyer',
  buyer              TEXT NOT NULL,
  seller             TEXT NOT NULL,
  purpose            TEXT NOT NULL,
  buyer_constraints  TEXT NOT NULL, -- '' = not given yet
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
  conflicts_json  TEXT NOT NULL DEFAULT '[]', -- conflictNotes (string[])
  structured_conflicts_json TEXT NOT NULL DEFAULT '[]', -- Conflict[]
  signatures_json TEXT NOT NULL DEFAULT '[]', -- Signature[]
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
  retry_delay_ms INTEGER,
  tool_mode      TEXT,
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
  initiator: Party;
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
  structured_conflicts_json: string;
  signatures_json: string;
  buyer_approved: number;
  seller_approved: number;
  created_at: number;
};

// Columns added after the first schema; older local DBs get them via ALTER TABLE.
const ADDED_COLUMNS: Record<string, [string, string][]> = {
  agent_calls: [
    ["provider", "TEXT NOT NULL DEFAULT 'unknown'"],
    ["status_code", "INTEGER"],
    ["transient", "INTEGER NOT NULL DEFAULT 0"],
    ["retry_delay_ms", "INTEGER"],
    ["tool_mode", "TEXT"],
  ],
  drafts: [["initiator", "TEXT NOT NULL DEFAULT 'buyer'"]],
  sow_versions: [
    ["structured_conflicts_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["signatures_json", "TEXT NOT NULL DEFAULT '[]'"],
  ],
};

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hash");
/** The minimum saveRuling needs; agent rulings carry more (scores, model, …), arbitrator rulings may add anything. */
const RulingShape = z.union([
  z.looseObject({
    source: z.literal("arbitrator"),
    dealId: z.number().int().nonnegative(),
    sowHash: hex32,
    buyerBps: z.number().int().min(0).max(TOTAL_BPS),
    ruling: z.string().min(1),
  }),
  z.looseObject({
    source: z.literal("agent").optional(),
    dealId: z.number().int().nonnegative(),
    sowHash: hex32,
    buyerBps: z.number().int().min(0).max(TOTAL_BPS),
    scores: z.array(z.unknown()),
  }),
]);

const unixNow = () => Math.floor(Date.now() / 1000);

export class SowStore {
  readonly db: Database.Database;

  /**
   * Pass B1's open better-sqlite3 Database (shared connection; its pragmas are left alone), or a path
   * (default env DB_PATH, else ./data/app.sqlite; ":memory:" for tests), which this store opens itself.
   */
  constructor(dbOrPath: Database.Database | string = process.env.DB_PATH || "./data/app.sqlite") {
    if (typeof dbOrPath === "string") {
      if (dbOrPath !== ":memory:") mkdirSync(dirname(dbOrPath), { recursive: true });
      this.db = new Database(dbOrPath);
      this.db.pragma("journal_mode = WAL");
      this.db.pragma("foreign_keys = ON");
    } else {
      this.db = dbOrPath;
    }
    this.db.exec(SCHEMA);
    for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
      const have = new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
      for (const [name, type] of columns) if (!have.has(name)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
    }
  }

  createDraft(input: NewDraft, now: number, id: string = randomUUID()): Draft {
    const bothTerms = !!input.buyerConstraints && !!input.sellerPoints;
    this.db
      .prepare(
        `INSERT INTO drafts (id, initiator, buyer, seller, purpose, buyer_constraints, seller_points, amount, delivery_deadline,
           review_window_secs, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.initiator ?? "buyer",
        input.buyer,
        input.seller,
        input.purpose,
        input.buyerConstraints ?? "",
        input.sellerPoints ?? null,
        input.amount,
        input.deliveryDeadline,
        input.reviewWindowSecs,
        bothTerms ? "ready_to_merge" : "awaiting_other",
        now,
        now,
      );
    return this.getDraft(id)!;
  }

  /** Drafts where `address` is the buyer or the seller, newest first. */
  listDraftsFor(address: string): Draft[] {
    const a = address.toLowerCase();
    const rows = this.db
      .prepare(
        `SELECT d.*, (SELECT MAX(version) FROM sow_versions v WHERE v.draft_id = d.id) AS latest_version
         FROM drafts d WHERE d.buyer = ? OR d.seller = ? ORDER BY d.created_at DESC, d.rowid DESC`,
      )
      .all(a, a) as DraftRow[];
    return rows.map(toDraft);
  }

  /** Removes a draft, its SOW versions and its agent_calls rows (used by seed:demo to reset demo drafts). */
  deleteDraft(id: string): void {
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM sow_versions WHERE draft_id = ?`).run(id);
      this.db.prepare(`DELETE FROM agent_calls WHERE subject = ?`).run(`draft:${id}`);
      this.db.prepare(`DELETE FROM drafts WHERE id = ?`).run(id);
    })();
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

  /** Records one side's terms (buyer → buyerConstraints, seller → sellerPoints); the draft is then ready to merge. */
  setTerms(id: string, party: Party, terms: string, now: number): Draft {
    const col = party === "buyer" ? "buyer_constraints" : "seller_points";
    this.db.prepare(`UPDATE drafts SET ${col} = ?, status = 'ready_to_merge', updated_at = ? WHERE id = ?`).run(terms, now, id);
    return this.getDraft(id)!;
  }

  setSellerPoints(id: string, sellerPoints: string, now: number): Draft {
    return this.setTerms(id, "seller", sellerPoints, now);
  }

  /** Stores a new SOW version with both approvals (and signatures) reset. */
  addVersion(
    draftId: string,
    sowJson: string,
    sowHash: string,
    conflictNotes: string[],
    now: number,
    conflicts: Conflict[] = [],
  ): StoredSowVersion {
    const tx = this.db.transaction(() => {
      const { next } = this.db
        .prepare(`SELECT COALESCE(MAX(version), 0) + 1 AS next FROM sow_versions WHERE draft_id = ?`)
        .get(draftId) as { next: number };
      this.db
        .prepare(
          `INSERT INTO sow_versions (draft_id, version, sow_json, sow_hash, conflicts_json, structured_conflicts_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(draftId, next, sowJson, sowHash, JSON.stringify(conflictNotes), JSON.stringify(conflicts), now);
      this.db.prepare(`UPDATE drafts SET status = 'sow_proposed', updated_at = ? WHERE id = ?`).run(now, draftId);
      return next;
    });
    return this.getVersion(draftId, tx())!;
  }

  getVersion(draftId: string, version: number): StoredSowVersion | undefined {
    const row = this.db
      .prepare(`SELECT * FROM sow_versions WHERE draft_id = ? AND version = ?`)
      .get(draftId, version) as VersionRow | undefined;
    return row && toVersion(row);
  }

  getLatestVersion(draftId: string): StoredSowVersion | undefined {
    const row = this.db
      .prepare(`SELECT * FROM sow_versions WHERE draft_id = ? ORDER BY version DESC LIMIT 1`)
      .get(draftId) as VersionRow | undefined;
    return row && toVersion(row);
  }

  /** Replaces the structured conflicts of one version (used to record proposals). */
  setConflicts(draftId: string, version: number, conflicts: Conflict[], now: number): StoredSowVersion {
    this.db
      .prepare(`UPDATE sow_versions SET structured_conflicts_json = ? WHERE draft_id = ? AND version = ?`)
      .run(JSON.stringify(conflicts), draftId, version);
    this.db.prepare(`UPDATE drafts SET updated_at = ? WHERE id = ?`).run(now, draftId);
    return this.getVersion(draftId, version)!;
  }

  /** Stores a party's signature on a version, replacing that party's earlier one. */
  addSignature(draftId: string, version: number, sig: Signature): StoredSowVersion {
    const v = this.getVersion(draftId, version)!;
    const signatures = [...v.signatures.filter((s) => s.party !== sig.party), sig];
    this.db.prepare(`UPDATE sow_versions SET signatures_json = ? WHERE draft_id = ? AND version = ?`).run(JSON.stringify(signatures), draftId, version);
    return this.getVersion(draftId, version)!;
  }

  approve(draftId: string, version: number, party: Party, now: number): StoredSowVersion {
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
        `INSERT INTO agent_calls (subject, kind, attempt, provider, model, prompt_version, request_json, response_json, error, status_code, transient, retry_delay_ms, tool_mode, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        call.retryDelayMs ?? null,
        call.toolMode ?? null,
        now,
      );
  }

  /** The agreed SOW of the draft linked to an on-chain deal id (latest version; linked drafts can't change), or null. */
  getSowForDeal(dealId: number | string | bigint): DealSow | null {
    const id = typeof dealId === "string" ? (/^\d+$/.test(dealId) ? Number(dealId) : NaN) : Number(dealId);
    if (!Number.isSafeInteger(id) || id < 0) return null;
    const row = this.db
      .prepare(
        `SELECT v.draft_id, v.version, v.sow_json, v.sow_hash FROM drafts d JOIN sow_versions v ON v.draft_id = d.id
         WHERE d.deal_id = ? AND d.status = 'linked' ORDER BY v.version DESC LIMIT 1`,
      )
      .get(id) as { draft_id: string; version: number; sow_json: string; sow_hash: string } | undefined;
    return row ? { sow: parseSow(JSON.parse(row.sow_json)), sowHash: row.sow_hash, draftId: row.draft_id, version: row.version } : null;
  }

  /**
   * Stores a ruling under reasoningHash = hashJson(reasoning) and returns that hash (what goes on-chain).
   * Agent rulings (from scoreDispute) and human arbitrator rulings (minimal: { source: "arbitrator", dealId, sowHash,
   * buyerBps, ruling }, extra fields allowed) alike. The object is hashed exactly as given. Idempotent.
   */
  saveRuling(reasoning: AnyReasoning, now: number = unixNow()): `0x${string}` {
    const r = RulingShape.safeParse(reasoning);
    if (!r.success) throw new TypeError(`saveRuling: invalid ruling: ${r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
    const reasoningHash = hashJson(reasoning);
    this.db
      .prepare(`INSERT OR IGNORE INTO dispute_rulings (reasoning_hash, deal_id, reasoning_json, created_at) VALUES (?, ?, ?, ?)`)
      .run(reasoningHash, reasoning.dealId, JSON.stringify(reasoning), now);
    return reasoningHash;
  }

  /** Every stored ruling for a deal, newest first (agent proposals and the arbitrator's final ruling). */
  getRulingsForDeal(dealId: number): { reasoningHash: string; reasoning: AnyReasoning; createdAt: number }[] {
    const rows = this.db
      .prepare(`SELECT reasoning_hash, reasoning_json, created_at FROM dispute_rulings WHERE deal_id = ? ORDER BY created_at DESC, rowid DESC`)
      .all(dealId) as { reasoning_hash: string; reasoning_json: string; created_at: number }[];
    return rows.map((r) => ({ reasoningHash: r.reasoning_hash, reasoning: JSON.parse(r.reasoning_json) as AnyReasoning, createdAt: r.created_at }));
  }

  /** The stored ruling for a reasoningHash (any hex case), or undefined. */
  getRuling(reasoningHash: string): AnyReasoning | undefined {
    const row = this.db.prepare(`SELECT reasoning_json FROM dispute_rulings WHERE reasoning_hash = ?`).get(reasoningHash.toLowerCase()) as
      | { reasoning_json: string }
      | undefined;
    return row && (JSON.parse(row.reasoning_json) as AnyReasoning);
  }
}

function toDraft(r: DraftRow): Draft {
  return {
    id: r.id,
    initiator: r.initiator,
    buyer: r.buyer,
    seller: r.seller,
    purpose: r.purpose,
    ...(r.buyer_constraints !== "" && { buyerConstraints: r.buyer_constraints }),
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

function toVersion(r: VersionRow): StoredSowVersion {
  return {
    draftId: r.draft_id,
    version: r.version,
    sowJson: r.sow_json,
    sowHash: r.sow_hash,
    conflictNotes: JSON.parse(r.conflicts_json) as string[],
    conflicts: JSON.parse(r.structured_conflicts_json) as Conflict[],
    signatures: JSON.parse(r.signatures_json) as Signature[],
    buyerApproved: r.buyer_approved === 1,
    sellerApproved: r.seller_approved === 1,
    createdAt: r.created_at,
  };
}
