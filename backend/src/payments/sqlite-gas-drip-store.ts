import type { Address, Hex } from "viem";
import type { PaymentsSqliteDatabase } from "./sqlite-store";
import type { GasDripStore } from "./gas-drip";

/** Atomic, one-attempt-per-address gas-drip claims in the shared SQLite database. */
export class SqliteGasDripStore implements GasDripStore {
  constructor(private readonly database: PaymentsSqliteDatabase) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS gas_drips (
        address TEXT PRIMARY KEY COLLATE NOCASE,
        status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
        tx_hash TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async claim(address: Address): Promise<boolean> {
    return this.withImmediateTransaction(() => {
      const result = this.database
        .prepare(
          `INSERT INTO gas_drips (address, status, updated_at) VALUES (?, 'pending', CURRENT_TIMESTAMP)
           ON CONFLICT(address) DO NOTHING`,
        )
        .run(address.toLowerCase());
      return result.changes === 1;
    });
  }

  async markSent(address: Address, txHash: Hex): Promise<void> {
    const result = this.database
      .prepare(
        `UPDATE gas_drips SET status = 'sent', tx_hash = ?, updated_at = CURRENT_TIMESTAMP
         WHERE address = ? AND status = 'pending'`,
      )
      .run(txHash, address.toLowerCase());
    if (result.changes !== 1) throw new Error("Could not persist gas-drip transaction");
  }

  async markFailed(address: Address): Promise<void> {
    this.database
      .prepare(
        `UPDATE gas_drips SET status = 'failed', updated_at = CURRENT_TIMESTAMP
         WHERE address = ? AND status = 'pending'`,
      )
      .run(address.toLowerCase());
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
