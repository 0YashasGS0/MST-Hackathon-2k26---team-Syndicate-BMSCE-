import type { Abi, Address, PublicClient, WalletClient } from "viem";
import { createAuthRouter } from "../auth";
import type { AuthSqliteDatabase } from "../auth";
import type { PaymentsSqliteDatabase } from "./sqlite-store";
import { SqlitePaymentStore } from "./sqlite-store";
import { SqliteGasDripStore } from "./sqlite-gas-drip-store";
import { createPaymentsRouter } from "./routes";
import { createViemOnrampChain } from "./viem-chain";
import { createViemGasDripChain, gasDrip } from "./gas-drip";

type ContractTransactionSender = (
  wallet: any,
  args: any,
) => Promise<{ hash: `0x${string}`; receipt: { status: string } }>;

export type PgIntegrationDependencies = {
  database: PaymentsSqliteDatabase;
  publicClient: PublicClient;
  orgClient: WalletClient;
  escrowAddress: Address;
  usdAddress: Address;
  escrowAbi: Abi;
  usdAbi: Abi;
  sendContractTx: ContractTransactionSender;
};

function createOrgFundingTxReader(
  database: PaymentsSqliteDatabase,
  orgAddress: Address,
): (dealId: number) => Promise<string | null> {
  return async (dealId) => {
    const value = database
      .prepare(
        `SELECT tx_hash, args_json FROM chain_events
         WHERE deal_id = ? AND name = 'DealFunded'
         ORDER BY block DESC LIMIT 1`,
      )
      .get(dealId);
    if (typeof value !== "object" || value === null) return null;

    try {
      const row = value as { tx_hash?: unknown; args_json?: unknown };
      const args = JSON.parse(String(row.args_json)) as { funder?: unknown };
      if (
        typeof row.tx_hash === "string" &&
        typeof args.funder === "string" &&
        args.funder.toLowerCase() === orgAddress.toLowerCase()
      ) {
        return row.tx_hash;
      }
    } catch {
      // The event has not been indexed or its stored payload is malformed.
    }
    return null;
  };
}

/**
 * Bind PG-owned payment routes and gas drip to B1's shared SQLite and viem
 * clients. B1 can mount `paymentsRouter` in its Express app and invoke
 * `gasDripAddress` after successful on-chain KYC approval.
 */
export function createPgIntegration(dependencies: PgIntegrationDependencies) {
  if (!dependencies.orgClient.account) throw new Error("ORG wallet client is not configured");
  const orgAddress = dependencies.orgClient.account.address;
  const paymentStore = new SqlitePaymentStore(dependencies.database);
  const chain = createViemOnrampChain({
    publicClient: dependencies.publicClient,
    orgClient: dependencies.orgClient,
    escrowAddress: dependencies.escrowAddress,
    usdAddress: dependencies.usdAddress,
    escrowAbi: dependencies.escrowAbi,
    usdAbi: dependencies.usdAbi,
    sendContractTx: dependencies.sendContractTx,
    getOrgFundingTx: createOrgFundingTxReader(dependencies.database, orgAddress),
  });
  const gasDripStore = new SqliteGasDripStore(dependencies.database);
  const gasDripChain = createViemGasDripChain(dependencies.publicClient, dependencies.orgClient);

  return {
    authRouter: createAuthRouter(dependencies.database as AuthSqliteDatabase),
    paymentsRouter: createPaymentsRouter({
      sessionStore: paymentStore,
      confirmationStore: paymentStore,
      historyStore: paymentStore,
      readDeal: chain.getDeal,
      confirmationChain: chain,
    }),
    gasDripAddress: (address: string) => gasDrip(gasDripStore, gasDripChain, address),
  };
}
