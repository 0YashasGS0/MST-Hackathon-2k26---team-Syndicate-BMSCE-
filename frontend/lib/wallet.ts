"use client";
// Wallet sign-in on top of PG's connector (lib/pg-wallet.ts, docs/API.md "PG wallet and transaction module"):
// connect + switch to MST Testnet → GET /auth/nonce → wallet signs messageToSign → POST /auth/verify.
// The connector lives here, not in React state: it wraps the extension's provider and can't be serialised.
import type { Address, Hex } from "viem";
import { api } from "./api";
import { demoWalletAccount } from "./device-key";
import {
  bindWalletSession,
  createInjectedWalletConnector,
  discoverWallets,
  MST_TESTNET_CHAIN_ID_HEX,
  type Eip1193Provider,
  type InjectedWalletOption,
  type WalletConnector,
} from "./pg-wallet";
import type { ApiUser } from "./types";

export type { InjectedWalletOption };
export type WalletKind = "injected" | "demo";

let connector: WalletConnector | undefined;
let provider: Eip1193Provider | undefined;

/** MetaMask / BridgeKey (EIP-6963), else window.ethereum. Empty when the browser has no wallet. */
export const listWallets = () => discoverWallets();

/** Signs in with an injected wallet, or with this browser's demo wallet when `option` is omitted. */
export async function signInWithWallet(option?: InjectedWalletOption): Promise<{ user: ApiUser; kind: WalletKind }> {
  let address: Address;
  let sign: (message: string) => Promise<Hex>;
  if (option) {
    const c = createInjectedWalletConnector(option.provider);
    ({ address } = await c.connect()); // also adds / switches to MST Testnet
    sign = (m) => c.signMessage(m);
    connector = c;
    provider = option.provider;
  } else {
    const account = demoWalletAccount();
    address = account.address;
    sign = (message) => account.signMessage({ message });
    connector = undefined;
    provider = undefined;
  }
  const nonce = await api.authNonce(address);
  const signature = await sign(nonce.messageToSign);
  const { user } = await api.authVerify(nonce.messageToSign, signature);
  return { user, kind: option ? "injected" : "demo" };
}

/** Signs in as one of the pre-seeded demo accounts (Arbitrator, Priya, Ravi) without a real wallet.
 *  Uses a locally-generated burner key to produce a real hex signature that passes the production
 *  backend's /auth/verify validation (which rejects non-hex values like "0xdemo"). */
export async function signInWithDemoAccount(phone: string): Promise<{ user: ApiUser; kind: WalletKind }> {
  // Use a per-phone burner key stored in localStorage so the address is stable across page reloads
  const storageKey = `fe.demo.acct.${phone}`;
  let pk: Hex | null = null;
  try { pk = localStorage.getItem(storageKey) as Hex | null; } catch { /* SSR / private mode */ }
  if (!pk) {
    // Import here to keep the bundle lazy — only used when real wallets are absent
    const { generatePrivateKey } = await import("viem/accounts");
    pk = generatePrivateKey();
    try { localStorage.setItem(storageKey, pk); } catch { /* SSR / private mode */ }
  }
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(pk);
  const nonce = await api.authNonce(account.address);
  const signature = await account.signMessage({ message: nonce.messageToSign });
  const { user } = await api.authVerify(nonce.messageToSign, signature);
  return { user, kind: "demo" };
}

/**
 * Watches the signed-in wallet. An account switch clears the backend session (POST /auth/logout) and asks for a
 * fresh sign-in; a network switch away from MST reports `false` so on-chain actions can be disabled.
 * After a page reload it re-attaches to whichever injected wallet still exposes `address`, without a prompt.
 */
export async function watchWallet(
  address: Address,
  handlers: { onLoginRequired: () => void; onChain: (onMst: boolean) => void },
): Promise<() => void> {
  if (!connector) {
    for (const w of await discoverWallets()) {
      const accounts = (await w.provider.request({ method: "eth_accounts" }).catch(() => [])) as string[];
      if (accounts.some((a) => a.toLowerCase() === address.toLowerCase())) {
        connector = createInjectedWalletConnector(w.provider);
        provider = w.provider;
        break;
      }
    }
  }
  if (!connector) return () => {};
  const chainId = await provider?.request({ method: "eth_chainId" }).catch(() => undefined);
  if (typeof chainId === "string") handlers.onChain(chainId.toLowerCase() === MST_TESTNET_CHAIN_ID_HEX);
  // PG's binding always clears the backend session on accountsChanged, so the app signs out too.
  const offAccounts = bindWalletSession(connector, { logout: () => api.logout(), onLoginRequired: handlers.onLoginRequired });
  const offChain = connector.onChainChanged((id) => handlers.onChain(id.toLowerCase() === MST_TESTNET_CHAIN_ID_HEX));
  return () => {
    offAccounts();
    offChain();
  };
}

/** The connector for contract calls (PG's sendPgContractAction), or undefined for the demo wallet. */
export const activeConnector = () => connector;

export function forgetWallet() {
  connector = undefined;
  provider = undefined;
}
