"use client";
// Wallet session. MetaMask when available; otherwise a mock buyer address so the UI is clickable.
// PG's SARAL adapter will plug in here as a second connect method.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createWalletClient, custom, type Address, type EIP1193Provider } from "viem";
import { mst } from "@/lib/chain";

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
}

export type Party = "buyer" | "seller";

type Session = {
  address?: Address;
  connecting: boolean;
  error?: string;
  connect: () => Promise<void>;
  disconnect: () => void;
  // Demo helper: lets one browser act as buyer or seller while APIs are mocked.
  viewAs: Party;
  setViewAs: (p: Party) => void;
};

const MOCK_ADDRESS = "0x1111111111111111111111111111111111111111" as Address;
const KEY = "fe.session.address";

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const [viewAs, setViewAs] = useState<Party>("buyer");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time restore from storage
      if (saved) setAddress(saved as Address);
    } catch {}
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(undefined);
    try {
      let a: Address = MOCK_ADDRESS;
      if (window.ethereum) {
        const wallet = createWalletClient({ chain: mst, transport: custom(window.ethereum) });
        [a] = await wallet.requestAddresses();
        try {
          await wallet.switchChain({ id: mst.id });
        } catch {
          await wallet.addChain({ chain: mst });
        }
      }
      setAddress(a);
      try {
        localStorage.setItem(KEY, a);
      } catch {}
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(undefined);
    try {
      localStorage.removeItem(KEY);
    } catch {}
  }, []);

  return (
    <Ctx.Provider value={{ address, connecting, error, connect, disconnect, viewAs, setViewAs }}>{children}</Ctx.Provider>
  );
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}
