import {
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { WalletConnector } from "./wallet-connector";

export const MST_EXPLORER_TX_URL = "https://testnet.mstscan.com/tx/";

export const PG_DEAL_ACTIONS = [
  "proposeDeal",
  "acceptDeal",
  "release",
  "raiseDispute",
  "acceptResolution",
  "escalate",
  "fund",
] as const;

export type PgDealAction = typeof PG_DEAL_ACTIONS[number];

export type ConfirmedWalletTransaction = {
  txHash: Hex;
  explorerUrl: string;
};

/**
 * Submit one of the escrow calls from FE and wait until its receipt is mined.
 * The connector checks the active chain immediately before creating the client.
 */
export async function sendPgContractAction(args: {
  connector: WalletConnector;
  publicClient: PublicClient;
  contractAddress: Address;
  abi: Abi;
  action: PgDealAction;
  args?: readonly unknown[];
}): Promise<ConfirmedWalletTransaction> {
  const walletClient = await args.connector.getWalletClient();
  const account = walletClient.account;
  if (!account) throw new Error("Connect your wallet before submitting this transaction.");

  const txHash = await walletClient.writeContract({
    address: args.contractAddress,
    abi: args.abi,
    functionName: args.action,
    args: args.args ?? [],
    account,
    chain: walletClient.chain,
  } as never) as Hex;

  const receipt = await args.publicClient.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction ${txHash} reverted on MST Testnet.`);
  }
  return { txHash, explorerUrl: `${MST_EXPLORER_TX_URL}${txHash}` };
}
