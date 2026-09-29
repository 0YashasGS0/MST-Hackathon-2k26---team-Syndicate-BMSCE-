// VENDORED COPY of PG's browser wallet module: backend/src/auth/wallet-connector.ts on geeth-dev @ afeba30.
// FE must not import from backend/. PG asked B2 to export this from @kernel-exploits/shared; once that lands,
// delete this file and import from the package instead. Don't edit it here: fix it on geeth-dev and re-copy.

import {
  createWalletClient,
  custom,
  defineChain,
  getAddress,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type SendTransactionParameters,
  type WalletClient,
} from "viem";

export const MST_TESTNET_CHAIN_ID = 91562037;
export const MST_TESTNET_CHAIN_ID_HEX = "0x5752035" as const;
export const TEST_GAS_FAUCET_URL = "https://faucet.mstblockchain.com/";
const MINIMUM_TEST_GAS = parseEther("0.05");

export type Eip1193Provider = {
  request(args: { method: string; params?: readonly unknown[] }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener?(event: string, listener: (...args: unknown[]) => void): unknown;
  isMetaMask?: boolean;
  providers?: Eip1193Provider[];
};

export type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

export type InjectedWalletOption = {
  id: string;
  name: string;
  provider: Eip1193Provider;
  info?: Eip6963ProviderInfo;
};

export type ConnectedWallet = { address: Address; provider: Eip1193Provider };
export type WalletTransaction = Omit<SendTransactionParameters, "account" | "chain">;
export type WalletChainListener = (chainId: string) => void;
export type WalletAccountListener = (address: Address | null) => void;
export type LoginRequiredHandler = (address: Address | null) => void;

export interface WalletConnector {
  connect(): Promise<ConnectedWallet>;
  signMessage(msg: string): Promise<Hex>;
  sendTransaction(tx: WalletTransaction): Promise<Hex>;
  ensureChain(): Promise<void>;
  getWalletClient(): Promise<WalletClient>;
  onAccountsChanged(listener: WalletAccountListener): () => void;
  onChainChanged(listener: WalletChainListener): () => void;
}

/** Revoke the prior browser session and tell FE to log in again after account changes. */
export function bindWalletSession(
  connector: WalletConnector,
  options: {
    onLoginRequired: LoginRequiredHandler;
    logout?: () => Promise<void>;
  },
): () => void {
  const logout = options.logout ?? (async () => {
    const response = await fetch("/auth/logout", { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("Could not clear the current wallet session.");
  });
  return connector.onAccountsChanged((address) => {
    void logout().catch(() => undefined).finally(() => options.onLoginRequired(address));
  });
}

const mstTestnet = defineChain({
  id: MST_TESTNET_CHAIN_ID,
  name: "MST Testnet",
  nativeCurrency: { name: "MST", symbol: "tMSTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnetrpc.mstblockchain.com"] } },
  blockExplorers: { default: { name: "MST Scan Testnet", url: "https://testnet.mstscan.com" } },
});

function walletErrorCode(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && typeof current === "object" && current !== null; depth += 1) {
    if ("code" in current && typeof (current as { code?: unknown }).code === "number") {
      return (current as { code: number }).code;
    }
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return undefined;
}

export class WalletUserRejectedError extends Error {
  readonly code = 4001;
  constructor() {
    super("You rejected the wallet request. Approve it in your wallet to continue.");
    this.name = "WalletUserRejectedError";
  }
}

function normalizeWalletError(error: unknown): Error {
  if (walletErrorCode(error) === 4001) return new WalletUserRejectedError();
  return error instanceof Error ? error : new Error("The wallet request failed.");
}

async function providerRequest(provider: Eip1193Provider, method: string, params?: readonly unknown[]): Promise<unknown> {
  try {
    return await provider.request({ method, ...(params ? { params } : {}) });
  } catch (error) {
    throw normalizeWalletError(error);
  }
}

function getBrowserWindow(): (Window & { ethereum?: Eip1193Provider }) | undefined {
  return typeof window === "undefined" ? undefined : window as Window & { ethereum?: Eip1193Provider };
}

function isProvider(value: unknown): value is Eip1193Provider {
  return typeof value === "object" && value !== null &&
    typeof (value as { request?: unknown }).request === "function";
}

function walletLabel(info: Eip6963ProviderInfo): "MetaMask" | "BridgeKey" | null {
  const identity = `${info.name} ${info.rdns}`.toLowerCase();
  if (identity.includes("metamask")) return "MetaMask";
  if (identity.includes("bridgekey")) return "BridgeKey";
  return null;
}

/** Discover EIP-6963 MetaMask/BridgeKey announcements, with window.ethereum as a legacy fallback. */
export async function discoverWallets(
  eventTarget: EventTarget | undefined = getBrowserWindow(),
  timeoutMs = 300,
): Promise<InjectedWalletOption[]> {
  const announced = new Map<string, InjectedWalletOption>();
  if (eventTarget) {
    const onAnnouncement = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      if (typeof detail !== "object" || detail === null) return;
      const announcement = detail as { info?: unknown; provider?: unknown };
      if (typeof announcement.info !== "object" || announcement.info === null || !isProvider(announcement.provider)) return;
      const info = announcement.info as Partial<Eip6963ProviderInfo>;
      if (typeof info.uuid !== "string" || typeof info.name !== "string" ||
        typeof info.icon !== "string" || typeof info.rdns !== "string") return;
      const fullInfo = info as Eip6963ProviderInfo;
      const name = walletLabel(fullInfo);
      if (!name) return;
      announced.set(fullInfo.uuid, {
        id: fullInfo.uuid,
        name,
        info: fullInfo,
        provider: announcement.provider,
      });
    };

    eventTarget.addEventListener("eip6963:announceProvider", onAnnouncement);
    eventTarget.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, timeoutMs)));
    eventTarget.removeEventListener("eip6963:announceProvider", onAnnouncement);
  }

  const browser = getBrowserWindow();
  const injected = browser?.ethereum;
  if (injected && announced.size === 0) {
    const providers = injected.providers?.length ? injected.providers : [injected];
    providers.forEach((provider, index) => {
      if (!isProvider(provider)) return;
      const name = provider.isMetaMask ? "MetaMask" : "Injected wallet";
      announced.set(`window.ethereum:${index}`, {
        id: `window.ethereum:${index}`,
        name,
        provider,
      });
    });
  } else if (injected && ![...announced.values()].some((wallet) => wallet.name === "MetaMask")) {
    const fallback = injected.providers?.find((provider) => provider.isMetaMask) ??
      (injected.isMetaMask ? injected : undefined);
    if (fallback && isProvider(fallback)) {
      announced.set("window.ethereum:metamask", {
        id: "window.ethereum:metamask",
        name: "MetaMask",
        provider: fallback,
      });
    }
  }

  return [...announced.values()].sort((a, b) => {
    const order = (name: string) => name === "MetaMask" ? 0 : name === "BridgeKey" ? 1 : 2;
    return order(a.name) - order(b.name) || a.name.localeCompare(b.name);
  });
}

/** Legacy provider list for callers that only need raw injected EIP-1193 providers. */
export function listInjectedWalletProviders(): Eip1193Provider[] {
  const injected = getBrowserWindow()?.ethereum;
  const providers = injected?.providers?.length ? injected.providers : injected ? [injected] : [];
  return providers.filter(isProvider);
}

/** Standard EIP-1193 connector. Vendor SDK methods are never used. */
export function createInjectedWalletConnector(injectedProvider: Eip1193Provider): WalletConnector {
  if (!isProvider(injectedProvider)) throw new Error("No injected EIP-1193 wallet provider is available");

  let connected: ConnectedWallet | null = null;
  let client: WalletClient | null = null;
  let chainReady = false;
  const accountListeners = new Set<WalletAccountListener>();
  const chainListeners = new Set<WalletChainListener>();

  const setAccount = (accounts: unknown): void => {
    const first = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof first !== "string") {
      connected = null;
      client = null;
      accountListeners.forEach((listener) => listener(null));
      return;
    }
    const address = getAddress(first);
    connected = { address, provider: injectedProvider };
    client = createWalletClient({ account: address, chain: mstTestnet, transport: custom(injectedProvider as never) });
    accountListeners.forEach((listener) => listener(address));
  };

  const handleAccountsChanged = (...args: unknown[]) => setAccount(args[0]);
  const handleChainChanged = (...args: unknown[]) => {
    const chainId = typeof args[0] === "string" ? args[0] : "";
    chainReady = chainId.toLowerCase() === MST_TESTNET_CHAIN_ID_HEX;
    chainListeners.forEach((listener) => listener(chainId));
  };
  injectedProvider.on?.("accountsChanged", handleAccountsChanged);
  injectedProvider.on?.("chainChanged", handleChainChanged);

  const addMstChain = async (): Promise<void> => {
    await providerRequest(injectedProvider, "wallet_addEthereumChain", [{
      chainId: MST_TESTNET_CHAIN_ID_HEX,
      chainName: "MST Testnet",
      nativeCurrency: { name: "MST", symbol: "tMSTC", decimals: 18 },
      rpcUrls: ["https://testnetrpc.mstblockchain.com"],
      blockExplorerUrls: ["https://testnet.mstscan.com"],
    }]);
  };

  const switchToMst = async (): Promise<void> => {
    const current = await providerRequest(injectedProvider, "eth_chainId");
    if (typeof current !== "string") throw new Error("Wallet returned an invalid chain ID.");
    if (current.toLowerCase() === MST_TESTNET_CHAIN_ID_HEX) {
      chainReady = true;
      return;
    }
    try {
      await providerRequest(injectedProvider, "wallet_switchEthereumChain", [{ chainId: MST_TESTNET_CHAIN_ID_HEX }]);
    } catch (error) {
      if (walletErrorCode(error) !== 4902) throw error;
      await addMstChain();
      await providerRequest(injectedProvider, "wallet_switchEthereumChain", [{ chainId: MST_TESTNET_CHAIN_ID_HEX }]);
    }
    const selected = await providerRequest(injectedProvider, "eth_chainId");
    chainReady = typeof selected === "string" && selected.toLowerCase() === MST_TESTNET_CHAIN_ID_HEX;
    if (!chainReady) throw new Error("Switch your wallet to MST Testnet (chain 91562037) to continue.");
  };

  const requireMstWalletClient = async (): Promise<WalletClient> => {
    if (!connected || !client) throw new Error("Connect your wallet before continuing.");
    const current = await providerRequest(injectedProvider, "eth_chainId");
    chainReady = typeof current === "string" && current.toLowerCase() === MST_TESTNET_CHAIN_ID_HEX;
    if (!chainReady) throw new Error("Wallet network changed. Switch back to MST Testnet (chain 91562037) before continuing.");
    return client;
  };

  return {
    async connect() {
      try {
        const accounts = await providerRequest(injectedProvider, "eth_requestAccounts");
        setAccount(accounts);
        if (!connected) throw new Error("Wallet returned no account.");
        await switchToMst();
        return connected;
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    async ensureChain() {
      if (!connected) {
        await this.connect();
        return;
      }
      try { await switchToMst(); } catch (error) { throw normalizeWalletError(error); }
    },
    async getWalletClient() {
      return requireMstWalletClient();
    },
    async signMessage(msg) {
      try {
        const walletClient = await requireMstWalletClient();
        return await walletClient.signMessage({ account: connected!.address, message: msg });
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    async sendTransaction(tx) {
      try {
        const walletClient = await requireMstWalletClient();
        return await walletClient.sendTransaction({ ...tx, account: connected!.address, chain: mstTestnet } as SendTransactionParameters);
      } catch (error) {
        throw normalizeWalletError(error);
      }
    },
    onAccountsChanged(listener) {
      accountListeners.add(listener);
      return () => accountListeners.delete(listener);
    },
    onChainChanged(listener) {
      chainListeners.add(listener);
      return () => chainListeners.delete(listener);
    },
  };
}

export type TestGasStatus = {
  balanceWei: string;
  needsGas: boolean;
  message: string | null;
  faucetUrl: string;
};

/** FE checks this after login; B1's gasDrip hook runs after KYC approval. */
export async function getTestGasStatus(publicClient: PublicClient, address: Address): Promise<TestGasStatus> {
  const balance = await publicClient.getBalance({ address });
  const needsGas = balance < MINIMUM_TEST_GAS;
  return {
    balanceWei: balance.toString(),
    needsGas,
    message: needsGas ? "Getting you test gas…" : null,
    faucetUrl: TEST_GAS_FAUCET_URL,
  };
}

function readSaralEnabled(): boolean {
  const env = (globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.SARAL_ENABLED === "true";
}

/** Fail-closed placeholder. It intentionally contains no assumed SARAL API. */
export function createSaralWalletConnector(enabled = readSaralEnabled()): WalletConnector {
  void enabled;
  const unavailable = (): never => { throw new Error("SARAL not configured: awaiting mentor docs"); };
  return {
    connect: async () => unavailable(),
    signMessage: async () => unavailable(),
    sendTransaction: async () => unavailable(),
    ensureChain: async () => unavailable(),
    getWalletClient: async () => unavailable(),
    onAccountsChanged: () => () => undefined,
    onChainChanged: () => () => undefined,
  };
}
