"use client";
// Sends a DealEscrow call from the signed-in wallet: the injected wallet (MetaMask / BridgeKey, via PG's connector)
// or this browser's demo wallet. Waits for the receipt and throws if the transaction reverted.
import { createPublicClient, createWalletClient, http, type Hex, type WalletClient } from "viem";
import { mst } from "./chain";
import { ESCROW_ADDRESS, escrowAbi } from "./contracts";
import { demoWalletAccount } from "./device-key";
import { activeConnector } from "./wallet";

type EscrowFn = "acceptDeal" | "markDelivered" | "release" | "raiseDispute" | "acceptResolution" | "escalate" | "claimTimeout";

const publicClient = () => createPublicClient({ chain: mst, transport: http() });

async function walletClient(): Promise<WalletClient> {
  const connector = activeConnector();
  if (connector) return connector.getWalletClient(); // also checks the wallet is on MST Testnet
  return createWalletClient({ account: demoWalletAccount(), chain: mst, transport: http() });
}

export async function sendEscrow(functionName: EscrowFn, args: readonly unknown[]): Promise<Hex> {
  if (!ESCROW_ADDRESS) throw new Error("The escrow contract address isn't configured (NEXT_PUBLIC_ESCROW_ADDRESS).");
  const wallet = await walletClient();
  const account = wallet.account;
  if (!account) throw new Error("Connect your wallet first.");
  const hash = await wallet.writeContract({
    address: ESCROW_ADDRESS,
    abi: escrowAbi,
    functionName,
    args: args as never,
    account,
    chain: mst,
  });
  const receipt = await publicClient().waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The transaction was reverted on-chain.");
  return hash;
}
