import type { Abi, Address, Hex, PublicClient, WalletClient } from "viem";
import type { PaymentConfirmationChain } from "./onramp";
import { mintMockUsd } from "./mint";

const DEAL_STATUSES = [
  "None",
  "Proposed",
  "Accepted",
  "Funded",
  "Delivered",
  "Disputed",
  "ResolutionProposed",
  "Escalated",
  "Released",
  "Refunded",
  "Resolved",
  "Cancelled",
] as const;

type ContractTransactionSender = (
  wallet: any,
  args: any,
) => Promise<{ hash: Hex; receipt: { status: string } }>;

export type ViemOnrampChainConfig = {
  publicClient: PublicClient;
  orgClient: WalletClient;
  escrowAddress: Address;
  usdAddress: Address;
  escrowAbi: Abi;
  usdAbi: Abi;
  sendContractTx: ContractTransactionSender;
  getOrgFundingTx(dealId: number): Promise<string | null>;
};

/**
 * Adapter for the clients exported by B1's backend/src/chain.ts.
 * DealEscrow.Status is an enum; Accepted is ordinal 2 in the main contract.
 */
export function createViemOnrampChain({
  publicClient,
  orgClient,
  escrowAddress,
  usdAddress,
  escrowAbi,
  usdAbi,
  sendContractTx,
  getOrgFundingTx,
}: ViemOnrampChainConfig): PaymentConfirmationChain {
  if (!orgClient.account) throw new Error("ORG wallet client is not configured");
  const orgAddress = orgClient.account.address;

  async function readDeal(dealId: number): Promise<{ status: string; amount: string }> {
    const result = (await publicClient.readContract({
      address: escrowAddress,
      abi: escrowAbi,
      functionName: "getDeal",
      args: [BigInt(dealId)],
    } as never)) as unknown;

    const amount = Array.isArray(result) ? result[2] : (result as { amount?: unknown } | null)?.amount;
    const status = Array.isArray(result) ? result[13] : (result as { status?: unknown } | null)?.status;
    if (amount === undefined || status === undefined) {
      throw new Error("DealEscrow.getDeal returned an unexpected value");
    }

    const statusIndex = Number(status);
    return {
      status: DEAL_STATUSES[statusIndex] ?? `Unknown(${statusIndex})`,
      amount: String(amount),
    };
  }

  async function assertFundingReady(amountBaseUnits: string): Promise<void> {
    if (!/^\d+$/.test(amountBaseUnits) || BigInt(amountBaseUnits) <= 0n) {
      throw new RangeError("MockUSD amount must be a positive integer base-unit string");
    }
    const allowance = (await publicClient.readContract({
      address: usdAddress,
      abi: usdAbi,
      functionName: "allowance",
      args: [orgAddress, escrowAddress],
    } as never)) as bigint;
    if (allowance < BigInt(amountBaseUnits)) {
      throw new Error("ORG has not approved enough MockUSD for DealEscrow.fundFor");
    }
  }

  return {
    getDeal: readDeal,
    getOrgFundingTx,
    assertFundingReady,

    async mint(amountBaseUnits: string): Promise<{ mintTx: Hex }> {
      if (!/^\d+$/.test(amountBaseUnits) || BigInt(amountBaseUnits) <= 0n) {
        throw new RangeError("MockUSD amount must be a positive integer base-unit string");
      }
      const { mintTx } = await mintMockUsd({
        orgClient,
        publicClient,
        usdAddress,
        orgAddress,
        amountBaseUnits,
      });
      return { mintTx };
    },

    async fundFor(dealId: number): Promise<{ fundTx: Hex }> {
      const deal = await readDeal(dealId);
      if (deal.status !== "Accepted") {
        throw new Error("Deal status changed before escrow funding");
      }
      await assertFundingReady(deal.amount);

      const { hash, receipt } = await sendContractTx(orgClient, {
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "fundFor",
        args: [BigInt(dealId)],
      });
      if (receipt.status !== "success") throw new Error(`DealEscrow.fundFor reverted: ${hash}`);
      return { fundTx: hash };
    },
  };
}
