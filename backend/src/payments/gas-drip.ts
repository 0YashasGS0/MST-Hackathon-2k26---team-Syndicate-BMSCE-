import {
  getAddress,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";

const MINIMUM_BALANCE = parseEther("0.05");
const DRIP_AMOUNT = parseEther("0.1");

export type GasDripResult =
  | { status: "not_needed"; balance: string }
  | { status: "already_claimed" }
  | { status: "sent"; txHash: Hex; amount: string };

export interface GasDripStore {
  /** Atomically reserve this address unless a successful or pending drip exists. */
  claim(address: Address): Promise<boolean>;
  markSent(address: Address, txHash: Hex): Promise<void>;
  markFailed(address: Address): Promise<void>;
}

export interface GasDripChain {
  getBalance(address: Address): Promise<bigint>;
  sendNative(address: Address, amount: bigint): Promise<{ txHash: Hex }>;
}

/** Adapt B1's ORG wallet and public viem clients to the gas-drip operation. */
export function createViemGasDripChain(
  publicClient: PublicClient,
  orgClient: WalletClient,
): GasDripChain {
  if (!orgClient.account) throw new Error("ORG wallet client is not configured");
  return {
    getBalance: (address) => publicClient.getBalance({ address }),
    async sendNative(address, amount) {
      const txHash = await orgClient.sendTransaction({
        account: orgClient.account!,
        to: address,
        value: amount,
        chain: orgClient.chain ?? undefined,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      if (receipt.status !== "success") throw new Error(`Gas-drip transaction reverted: ${txHash}`);
      return { txHash };
    },
  };
}

/** Give an address 0.1 MSTC once when its balance is below 0.05 MSTC. */
export async function gasDrip(
  store: GasDripStore,
  chain: GasDripChain,
  suppliedAddress: string,
): Promise<GasDripResult> {
  const address = getAddress(suppliedAddress);
  const balance = await chain.getBalance(address);
  if (balance >= MINIMUM_BALANCE) {
    return { status: "not_needed", balance: balance.toString() };
  }

  if (!(await store.claim(address))) return { status: "already_claimed" };

  let txHash: Hex;
  try {
    ({ txHash } = await chain.sendNative(address, DRIP_AMOUNT));
  } catch (error) {
    await store.markFailed(address);
    throw error;
  }

  // If persistence fails after the chain receipt, leave the row pending so a
  // later invocation cannot accidentally send a second drip.
  await store.markSent(address, txHash);
  return { status: "sent", txHash, amount: DRIP_AMOUNT.toString() };
}

export const gasDripThresholdWei = MINIMUM_BALANCE.toString();
export const gasDripAmountWei = DRIP_AMOUNT.toString();
