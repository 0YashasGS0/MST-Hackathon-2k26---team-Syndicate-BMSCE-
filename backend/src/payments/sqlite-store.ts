import type {
  NewPaymentRecord,
  PaymentConfirmationStore,
  PaymentHistoryStore,
  PaymentRecord,
  PaymentStatus,
  PayoutRecord,
} from "./onramp";

type SqliteValue = string | number | bigint | null;

type SqliteStatement = {
  run(...values: SqliteValue[]): { changes: number };
  get(...values: SqliteValue[]): unknown;
};

/** Structural subset of better-sqlite3's Database used by this adapter. */
export type PaymentsSqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
};

type PaymentRow = {
  id: unknown;
  deal_id: unknown;
  amount: unknown;
  status: unknown;
  mint_tx: unknown;
  fund_tx: unknown;
  created_at: unknown;
};

type PayoutRow = {
  deal_id: unknown;
  to_buyer: unknown;
  to_seller: unknown;
  final_status: unknown;
  tx_hash: unknown;
};

const PAYMENT_STATUSES = new Set<PaymentStatus>([
  "created",
  "paid",
  "minted",
  "funded",
  "failed",
]);

function toPaymentRecord(value: unknown): PaymentRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("Payment row was not found");
  }

  const row = value as PaymentRow;
  if (typeof row.status !== "string" || !PAYMENT_STATUSES.has(row.status as PaymentStatus)) {
    throw new Error("Payment row has an unknown status");
  }

  return {
    id: String(row.id),
    dealId: Number(row.deal_id),
    amount: String(row.amount),
    status: row.status as PaymentStatus,
    mintTx: row.mint_tx === null ? null : String(row.mint_tx),
    fundTx: row.fund_tx === null ? null : String(row.fund_tx),
    createdAt: String(row.created_at),
  };
}

function toPayoutRecord(value: unknown): PayoutRecord {
  if (typeof value !== "object" || value === null) {
    throw new Error("Payout row was not found");
  }
  const row = value as PayoutRow;
  return {
    dealId: Number(row.deal_id),
    toBuyer: String(row.to_buyer),
    toSeller: String(row.to_seller),
    finalStatus: String(row.final_status),
    txHash: String(row.tx_hash),
  };
}

/** Implements PG's payments and settlement reads on B1's shared SQLite DB. */
export class SqlitePaymentStore implements PaymentConfirmationStore, PaymentHistoryStore {
  constructor(private readonly database: PaymentsSqliteDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deal_id INTEGER UNIQUE,
        amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'created'
          CHECK (status IN ('created', 'paid', 'minted', 'funded', 'failed')),
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
      CREATE TABLE IF NOT EXISTS payment_claims (
        deal_id INTEGER PRIMARY KEY,
        claimed_until INTEGER NOT NULL
      );
    `);
  }

  async createIfAbsent(payment: NewPaymentRecord): Promise<PaymentRecord> {
    this.database
      .prepare(
        `INSERT INTO payments (deal_id, amount, status) VALUES (?, ?, ?)
         ON CONFLICT(deal_id) DO NOTHING`,
      )
      .run(payment.dealId, payment.amount, payment.status);

    const row = this.getPaymentRow(payment.dealId);
    if (!row) {
      throw new Error("Payment session could not be created or retrieved");
    }
    return toPaymentRecord(row);
  }

  async claimConfirmation(
    dealId: number,
  ): Promise<{ claimed: boolean; payment: PaymentRecord }> {
    return this.withImmediateTransaction(() => {
      let payment = this.getPaymentRow(dealId);
      if (!payment) {
        throw new Error(`Payment session not found for deal ${dealId}`);
      }
      let record = toPaymentRecord(payment);
      if (record.status === "funded") return { claimed: false, payment: record };

      const now = Date.now();
      const lease = this.database
        .prepare(
          `INSERT INTO payment_claims (deal_id, claimed_until) VALUES (?, ?)
           ON CONFLICT(deal_id) DO UPDATE SET claimed_until = excluded.claimed_until
           WHERE payment_claims.claimed_until <= ?`,
        )
        .run(dealId, now + 120_000, now);
      if (lease.changes !== 1) return { claimed: false, payment: record };

      if (record.status === "created" || record.status === "failed") {
        this.database
          .prepare(
            `UPDATE payments SET status = CASE WHEN mint_tx IS NOT NULL THEN 'minted' ELSE 'paid' END
             WHERE deal_id = ?`,
          )
          .run(dealId);
        payment = this.getPaymentRow(dealId);
        if (!payment) throw new Error(`Payment session not found for deal ${dealId}`);
        record = toPaymentRecord(payment);
      }
      return { claimed: true, payment: record };
    });
  }

  async recordMinted(dealId: number, mintTx: string): Promise<PaymentRecord> {
    const result = this.database
      .prepare(
        `UPDATE payments SET status = 'minted', mint_tx = ?
         WHERE deal_id = ? AND status = 'paid'`,
      )
      .run(mintTx, dealId);
    if (result.changes !== 1) throw new Error("Could not persist the MockUSD mint transaction");
    return this.requirePayment(dealId);
  }

  async recordFunded(dealId: number, fundTx: string): Promise<PaymentRecord> {
    const result = this.database
      .prepare(
        `UPDATE payments SET status = 'funded', fund_tx = ?
         WHERE deal_id = ? AND status = 'minted'`,
      )
      .run(fundTx, dealId);
    if (result.changes !== 1) throw new Error("Could not persist the escrow funding transaction");
    return this.requirePayment(dealId);
  }

  async markFailed(dealId: number): Promise<PaymentRecord> {
    this.database
      .prepare("UPDATE payments SET status = 'failed' WHERE deal_id = ? AND status != 'funded'")
      .run(dealId);
    return this.requirePayment(dealId);
  }

  async releaseConfirmation(dealId: number): Promise<void> {
    this.database.prepare("DELETE FROM payment_claims WHERE deal_id = ?").run(dealId);
  }

  async getPayment(dealId: number): Promise<PaymentRecord | null> {
    const row = this.getPaymentRow(dealId);
    return row ? toPaymentRecord(row) : null;
  }

  async getPayout(dealId: number): Promise<PayoutRecord | null> {
    const row = this.database
      .prepare(
        `SELECT deal_id, to_buyer, to_seller, final_status, tx_hash
         FROM payouts WHERE deal_id = ?`,
      )
      .get(dealId);
    return row === undefined ? null : toPayoutRecord(row);
  }

  private getPaymentRow(dealId: number): unknown | null {
    const row = this.database
      .prepare(
        `SELECT id, deal_id, amount, status, mint_tx, fund_tx, created_at
         FROM payments WHERE deal_id = ?`,
      )
      .get(dealId);
    return row === undefined ? null : row;
  }

  private requirePayment(dealId: number): PaymentRecord {
    const payment = this.getPaymentRow(dealId);
    if (!payment) throw new Error(`Payment session not found for deal ${dealId}`);
    return toPaymentRecord(payment);
  }

  private withImmediateTransaction<T>(work: () => T): T {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      try {
        this.database.exec("ROLLBACK");
      } catch {
        // Preserve the error that caused the transaction to fail.
      }
      throw error;
    }
  }
}
