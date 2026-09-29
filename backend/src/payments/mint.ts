import type { Address, Hex, PublicClient, WalletClient } from "viem";

const MOCK_USD_MINT_ABI = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

export type MintMockUsdInput = {
  /** ORG wallet client. Its account must be the MockUSD owner. */
  orgClient: WalletClient;
  /** Public client connected to the same chain as orgClient. */
  publicClient: PublicClient;
  /** MockUSD address supplied by B1's deployment configuration. */
  usdAddress: Address;
  /** ORG address that receives the newly minted tokens. */
  orgAddress: Address;
  /** Positive integer MockUSD base-unit amount (6 decimals). */
  amountBaseUnits: string;
};

/** Mint an exact base-unit amount of MockUSD to ORG and wait for success. */
export async function mintMockUsd({
  orgClient,
  publicClient,
  usdAddress,
  orgAddress,
  amountBaseUnits,
}: MintMockUsdInput): Promise<{ mintTx: Hex; amount: string }> {
  if (!/^\d+$/.test(amountBaseUnits) || BigInt(amountBaseUnits) <= 0n) {
    throw new RangeError("MockUSD amount must be a positive integer base-unit string");
  }
  if (!orgClient.account) throw new Error("ORG wallet client is not configured");
  if (orgClient.account.address.toLowerCase() !== orgAddress.toLowerCase()) {
    throw new Error("ORG wallet account does not match the configured ORG address");
  }

  const mintTx = await orgClient.writeContract({
    account: orgClient.account,
    chain: orgClient.chain,
    address: usdAddress,
    abi: MOCK_USD_MINT_ABI,
    functionName: "mint",
    args: [orgAddress, BigInt(amountBaseUnits)],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: mintTx });
  if (receipt.status !== "success") {
    throw new Error(`MockUSD mint transaction reverted: ${mintTx}`);
  }

  return { mintTx, amount: BigInt(amountBaseUnits).toString() };
}
