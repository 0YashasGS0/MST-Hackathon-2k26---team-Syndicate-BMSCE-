import {
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  type Address,
  type Hex,
  type SendTransactionParameters,
} from "viem";

export const MST_TESTNET_CHAIN_ID = 91562037;
const MST_CHAIN_ID_HEX = `0x${MST_TESTNET_CHAIN_ID.toString(16)}` as const;

export type Eip1193Provider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

export type ConnectedWallet = { address: Address; provider: Eip1193Provider };
export type WalletTransaction = Omit<SendTransactionParameters, "account" | "chain">;

export interface WalletConnector {
  connect(): Promise<ConnectedWallet>;
  signMessage(msg: string): Promise<Hex>;
  sendTransaction(tx: WalletTransaction): Promise<Hex>;
  ensureChain(): Promise<void>;
}

const mstTestnet = defineChain({
  id: MST_TESTNET_CHAIN_ID,
  name: "MST Testnet",
  nativeCurrency: { name: "MSTC", symbol: "MSTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnetrpc.mstblockchain.com"] } },
});

function getBrowserInjectedProvider(): Eip1193Provider | undefined {
  return listInjectedWalletProviders()[0];
}

/** Return injected EIP-1193 providers, including common multi-wallet injection sets. */
export function listInjectedWalletProviders(): Eip1193Provider[] {
  const root = globalThis as typeof globalThis & {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
  };
  const primary = root.ethereum;
  const candidates = primary?.providers?.length ? primary.providers : primary ? [primary] : [];
  return candidates.filter((provider) => typeof provider?.request === "function");
}

/**
 * Standard EIP-1193 connector. MetaMask and BridgeKey work through the same
 * methods whenever they expose a standard injected provider; no vendor SDK is used.
 */
export function createInjectedWalletConnector(
  injectedProvider: Eip1193Provider | undefined = getBrowserInjectedProvider(),
): WalletConnector {
  if (!injectedProvider || typeof injectedProvider.request !== "function") {
    throw new Error("No injected EIP-1193 wallet provider is available");
  }

  let connected: ConnectedWallet | undefined;
  let client: ReturnType<typeof createWalletClient> | undefined;

  const ensureConnected = async (): Promise<ConnectedWallet> => {
    const accounts = await injectedProvider.request({ method: "eth_requestAccounts" });
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
      throw new Error("Injected wallet returned no account");
    }
    const address = getAddress(accounts[0]);
    connected = { address, provider: injectedProvider };
    client = createWalletClient({ account: address, chain: mstTestnet, transport: custom(injectedProvider as never) });
    await ensureMstChain();
    return connected;
  };

  const ensureMstChain = async (): Promise<void> => {
    const chainIdRaw = await injectedProvider.request({ method: "eth_chainId" });
    if (typeof chainIdRaw !== "string") throw new Error("Wallet returned an invalid chain ID");
    if (Number.parseInt(chainIdRaw, 16) === MST_TESTNET_CHAIN_ID) return;
    try {
      await injectedProvider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MST_CHAIN_ID_HEX }],
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== 4902) throw error;
      await injectedProvider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: MST_CHAIN_ID_HEX,
          chainName: mstTestnet.name,
          nativeCurrency: mstTestnet.nativeCurrency,
          rpcUrls: [...mstTestnet.rpcUrls.default.http],
        }],
      });
      await injectedProvider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: MST_CHAIN_ID_HEX }],
      });
    }
    const selectedChain = await injectedProvider.request({ method: "eth_chainId" });
    if (typeof selectedChain !== "string" || Number.parseInt(selectedChain, 16) !== MST_TESTNET_CHAIN_ID) {
      throw new Error("Wallet did not switch to MST testnet (91562037)");
    }
  };

  return {
    async connect() {
      return ensureConnected();
    },
    async ensureChain() {
      await ensureConnected();
      await ensureMstChain();
    },
    async signMessage(msg) {
      const wallet = await ensureConnected();
      await ensureMstChain();
      return client!.signMessage({ account: wallet.address, message: msg });
    },
    async sendTransaction(tx) {
      const wallet = await ensureConnected();
      await ensureMstChain();
      return client!.sendTransaction({ ...tx, account: wallet.address, chain: mstTestnet } as SendTransactionParameters);
    },
  };
}

function readSaralEnabled(): boolean {
  const env = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.SARAL_ENABLED === "true";
}

/** Fail-closed placeholder. It intentionally contains no assumed SARAL API. */
export function createSaralWalletConnector(enabled = readSaralEnabled()): WalletConnector {
  void enabled; // Enabling the flag does not invent an undocumented integration.
  const unavailable = (): never => { throw new Error("SARAL not configured: awaiting mentor docs"); };
  return {
    connect: async () => unavailable(),
    signMessage: async () => unavailable(),
    sendTransaction: async () => unavailable(),
    ensureChain: async () => unavailable(),
  };
}
