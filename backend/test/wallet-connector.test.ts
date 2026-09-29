import { describe, expect, it } from "vitest";
import {
  bindWalletSession,
  createInjectedWalletConnector,
  createSaralWalletConnector,
  discoverWallets,
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

  it("discovers only announced MetaMask and standard EIP-1193 BridgeKey providers", async () => {
    const target = new EventTarget();
    const metamask: Eip1193Provider = { request: async () => null };
    const bridgeKey: Eip1193Provider = { request: async () => null };
    target.addEventListener("eip6963:requestProvider", () => {
      for (const [uuid, name, rdns, provider] of [
        ["mm", "MetaMask", "io.metamask", metamask],
        ["bk", "BridgeKey", "com.bridgekey.wallet", bridgeKey],
      ] as const) {
        const event = Object.assign(new Event("eip6963:announceProvider"), {
          detail: { info: { uuid, name, rdns, icon: "data:image/svg+xml,..." }, provider },
        });
        target.dispatchEvent(event);
      }
    });
    const wallets = await discoverWallets(target, 0);
    expect(wallets.map(({ name }) => name)).toEqual(["MetaMask", "BridgeKey"]);
    expect(wallets[1].provider).toBe(bridgeKey);
  });

  it("adds the specified MST chain after switch error 4902", async () => {
    let chainId = "0x1";
    const calls: Array<{ method: string; params?: readonly unknown[] }> = [];
    const provider: Eip1193Provider = {
      async request(request) {
        calls.push(request);
        if (request.method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000001"];
        if (request.method === "eth_chainId") return chainId;
        if (request.method === "wallet_switchEthereumChain") {
          if (!calls.some(({ method }) => method === "wallet_addEthereumChain")) {
            throw Object.assign(new Error("Unknown chain"), { code: 4902 });
          }
          chainId = "0x5752035";
          return null;
        }
        if (request.method === "wallet_addEthereumChain") return null;
        throw new Error(`Unexpected provider method ${request.method}`);
      },
    };
    await createInjectedWalletConnector(provider).connect();
    const add = calls.find(({ method }) => method === "wallet_addEthereumChain");
    expect(add?.params?.[0]).toMatchObject({
      chainId: "0x5752035",
      chainName: "MST Testnet",
      nativeCurrency: { name: "MST", symbol: "tMSTC", decimals: 18 },
      rpcUrls: ["https://testnetrpc.mstblockchain.com"],
      blockExplorerUrls: ["https://testnet.mstscan.com"],
    });
  });

  it("surfaces user rejection with a clear message", async () => {
    const provider: Eip1193Provider = {
      async request() { throw Object.assign(new Error("rejected"), { code: 4001 }); },
    };
    await expect(createInjectedWalletConnector(provider).connect())
      .rejects.toThrow("You rejected the wallet request. Approve it in your wallet to continue.");
  });

  it("notifies FE to log in again on accountsChanged and blocks actions off MST", async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    let chainId = "0x5752035";
    const provider: Eip1193Provider = {
      async request({ method }) {
        if (method === "eth_requestAccounts") return ["0x0000000000000000000000000000000000000001"];
        if (method === "eth_chainId") return chainId;
        throw new Error(`Unexpected provider method ${method}`);
      },
      on(event, listener) { listeners.set(event, listener); },
    };
    const connector = createInjectedWalletConnector(provider);
    await connector.connect();
    let logoutCount = 0;
    const requested: Array<string | null> = [];
    bindWalletSession(connector, {
      logout: async () => { logoutCount += 1; },
      onLoginRequired: (address) => requested.push(address),
    });
    listeners.get("accountsChanged")?.(["0x0000000000000000000000000000000000000002"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(logoutCount).toBe(1);
    expect(requested).toEqual(["0x0000000000000000000000000000000000000002"]);
    chainId = "0x1";
    listeners.get("chainChanged")?.(chainId);
    await expect(connector.getWalletClient()).rejects.toThrow("Wallet network changed");
    chainId = "0x5752035";
    listeners.get("chainChanged")?.(chainId);
    await expect(connector.getWalletClient()).resolves.toBeDefined();
  });
});
