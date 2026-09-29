import { describe, expect, it, vi } from "vitest";
import { sendPgContractAction } from "../src/auth/transaction-helper";
import type { WalletConnector } from "../src/auth/wallet-connector";

describe("PG transaction helper", () => {
  it("waits for a successful receipt and returns the hash and explorer link", async () => {
    const txHash = `0x${"ab".repeat(32)}` as `0x${string}`;
    const writeContract = vi.fn().mockResolvedValue(txHash);
    const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: "success" });
    const connector = {
      getWalletClient: async () => ({
        account: `0x${"01".repeat(20)}`,
        chain: { id: 91562037 },
        writeContract,
      }),
    } as unknown as WalletConnector;
    const result = await sendPgContractAction({
      connector,
      publicClient: { waitForTransactionReceipt } as never,
      contractAddress: `0x${"02".repeat(20)}`,
      abi: [],
      action: "fund",
      args: [7n],
    });
    expect(result).toEqual({ txHash, explorerUrl: `https://testnet.mstscan.com/tx/${txHash}` });
    expect(waitForTransactionReceipt).toHaveBeenCalledWith({ hash: txHash });
  });

  it("rejects reverted receipts", async () => {
    const txHash = `0x${"cd".repeat(32)}` as `0x${string}`;
    const connector = {
      getWalletClient: async () => ({
        account: `0x${"01".repeat(20)}`,
        chain: { id: 91562037 },
        writeContract: async () => txHash,
      }),
    } as unknown as WalletConnector;
    await expect(sendPgContractAction({
      connector,
      publicClient: { waitForTransactionReceipt: async () => ({ status: "reverted" }) } as never,
      contractAddress: `0x${"02".repeat(20)}`,
      abi: [],
      action: "release",
    })).rejects.toThrow(`Transaction ${txHash} reverted on MST Testnet.`);
  });
});
