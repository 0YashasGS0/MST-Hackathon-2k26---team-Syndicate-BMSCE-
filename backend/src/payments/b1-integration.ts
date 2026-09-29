// PLACEHOLDER for PG's payments integration (branch `geeth-dev`); replaced wholesale by PG's real file at merge.
import { Router } from "express";

export function createPgIntegration(_deps: {
  database: unknown;
  publicClient: unknown;
  orgClient: unknown;
  escrowAddress: `0x${string}`;
  usdAddress: `0x${string}`;
  escrowAbi: unknown;
  usdAbi: unknown;
  sendContractTx: unknown;
}) {
  return { authRouter: Router(), paymentsRouter: Router(), gasDripAddress: async (_address: string): Promise<unknown> => undefined };
}
