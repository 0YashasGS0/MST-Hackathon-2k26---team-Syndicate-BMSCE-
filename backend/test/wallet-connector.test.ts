import { describe, expect, it } from "vitest";
import {
  createInjectedWalletConnector,
  createSaralWalletConnector,
  type Eip1193Provider,
} from "../src/auth/wallet-connector";

describe("wallet connectors", () => {
  it("connects through standard EIP-1193 and switches to MST testnet", async () => {
    let chainId = "0x1";
    const calls: string[] = [];
    const provider: Eip1193Provider = {
      async request({ method }) {
        calls.push(method);
        if (method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000001"];
        if (method === "eth_chainId") return chainId;
        if (method === "wallet_switchEthereumChain") {
          chainId = "0x5752035";
          return null;
        }
        throw new Error(`Unexpected provider method ${method}`);
      },
    };
    const connector = createInjectedWalletConnector(provider);
    const wallet = await connector.connect();
    expect(wallet.address).toBe("0x0000000000000000000000000000000000000001");
    expect(wallet.provider).toBe(provider);
    expect(chainId).toBe(`0x${(91562037).toString(16)}`);
    expect(calls).toContain("wallet_switchEthereumChain");
  });

  it("fails closed with the documented SARAL stub message", async () => {
    const connector = createSaralWalletConnector(false);
    await expect(connector.connect()).rejects.toThrow("SARAL not configured: awaiting mentor docs");
  });
});
