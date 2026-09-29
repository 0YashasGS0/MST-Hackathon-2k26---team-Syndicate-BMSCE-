"use client";
// Device-bound session, UPI style:
// - sign in once per device with a wallet (PG's nonce + signature login); a new device also needs the security
//   PIN and removes the old one
// - switching wallet account signs out (PG's bindWalletSession); leaving MST Testnet sets `onMst` to false
// - the app locks with the PIN every time it's opened, and again after 2 minutes in the background
// - the device checks every 15 s that it's still the registered one, and signs out if not
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { forgetWallet, watchWallet } from "@/lib/wallet";
import { LockScreen } from "./Pin";

type Session = {
  ready: boolean;
  user?: User;
  deviceId: string;
  notice?: string;
  onMst: boolean; // the wallet is on MST Testnet (always true for the demo wallet)
  signIn: (u: User) => void;
  updateUser: (u: User) => void;
  signOut: (notice?: string) => void;
};

const USER_KEY = "fe.session.wallet-user"; // renamed when login moved from phone OTP to wallet, so old sessions are dropped
const DEVICE_KEY = "fe.device.id";
const UNLOCK_KEY = "fe.unlocked"; // sessionStorage: cleared when the tab/app is closed
const RELOCK_AFTER_MS = 2 * 60_000;
const TAKEN_OVER = "Your account was registered on another device, so you were signed out here.";
const ACCOUNT_CHANGED = "Your wallet account changed. Sign in again to continue.";

const store = (s: () => Storage) => ({
  get: (k: string) => {
    try {
      return s().getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) s().removeItem(k);
      else s().setItem(k, v);
    } catch {}
  },
});
const local = store(() => localStorage);
const tab = store(() => sessionStorage);

// crypto.randomUUID only exists on https/localhost; phones opening the dev server over the LAN need a fallback.
const newId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
};

const Ctx = createContext<(Session & { unlocked: boolean; unlock: () => void }) | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User>();
  const [deviceId, setDeviceId] = useState("");
  const [notice, setNotice] = useState<string>();
  const [unlocked, setUnlocked] = useState(false);
  const [onMst, setOnMst] = useState(true);

  useEffect(() => {
    let id = local.get(DEVICE_KEY);
    if (!id) {
      id = newId();
      local.set(DEVICE_KEY, id);
    }
    let saved: User | undefined;
    try {
      saved = JSON.parse(local.get(USER_KEY) ?? "null") ?? undefined;
    } catch {}
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from storage */
    setDeviceId(id);
    setUser(saved);
    setUnlocked(!!saved && tab.get(UNLOCK_KEY) === saved.address);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (!saved) return setReady(true);
    // Refresh the saved account from the server before routing, so stale copies can't send people to the
    // wrong screen (e.g. "set your PIN" when one is already set).
    api.getMe(saved.address).then(
      (fresh) => {
        if (fresh) {
          const merged = { ...saved, ...fresh, deviceId: id!, deviceKey: saved!.deviceKey };
          local.set(USER_KEY, JSON.stringify(merged));
          setUser(merged);
        } else {
          local.set(USER_KEY, null);
          setUser(undefined);
          setNotice("Please log in again.");
        }
        setReady(true);
      },
      () => setReady(true), // offline: use the saved copy
    );
  }, []);

  const unlock = useCallback(() => {
    setUser((u) => {
      if (u) tab.set(UNLOCK_KEY, u.address);
      return u;
    });
    setUnlocked(true);
  }, []);

  const signOut = useCallback((n?: string) => {
    api.logout().catch(() => {}); // clears PG's session cookie
    forgetWallet();
    setOnMst(true);
    local.set(USER_KEY, null);
    tab.set(UNLOCK_KEY, null);
    setNotice(n);
    setUnlocked(false);
    setUser(undefined);
  }, []);

  // Device binding: re-check on launch, every 15 s, and whenever the app comes back to the foreground.
  // Coming back after RELOCK_AFTER_MS in the background locks the app again.
  useEffect(() => {
    if (!user || !deviceId) return;
    let hiddenAt = 0;
    const check = () =>
      api.checkDevice(user.address, deviceId).then(
        ({ valid }) => !valid && signOut(TAKEN_OVER),
        () => {}, // offline: keep the session
      );
    check();
    const t = setInterval(check, 15_000);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else {
        if (hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER_MS) {
          tab.set(UNLOCK_KEY, null);
          setUnlocked(false);
        }
        check();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, deviceId, signOut]);

  // Wallet: account switch → sign out; network switch → onMst.
  const address = user?.address;
  useEffect(() => {
    if (!address) return;
    let off = () => {};
    let live = true;
    watchWallet(address, { onLoginRequired: () => signOut(ACCOUNT_CHANGED), onChain: setOnMst }).then((o) =>
      live ? (off = o) : o(),
    );
    return () => {
      live = false;
      off();
    };
  }, [address, signOut]);

  // A fresh login (wallet signature, plus PIN on a new device) counts as unlocking.
  const signIn = useCallback((u: User) => {
    local.set(USER_KEY, JSON.stringify(u));
    tab.set(UNLOCK_KEY, u.address);
    setNotice(undefined);
    setUnlocked(true);
    setUser(u);
  }, []);

  const updateUser = useCallback((u: User) => {
    local.set(USER_KEY, JSON.stringify(u));
    setUser(u);
  }, []);

  return (
    <Ctx.Provider value={{ ready, user, deviceId, notice, onMst, signIn, updateUser, signOut, unlocked, unlock }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside <SessionProvider>");
  return s;
}

/** Signed-in user; only call inside pages rendered behind <AuthGate>. */
export function useUser() {
  const { user } = useSession();
  if (!user) throw new Error("useUser called without a signed-in user");
  return user;
}

/** Where a signed-in user belongs, or null if the current path is fine. */
function redirectFor(user: User | undefined, path: string): string | null {
  if (!user) return path === "/" ? null : "/";
  if (user.role === "arbitrator") return path.startsWith("/arbitrator") ? null : "/arbitrator";
  if (path.startsWith("/arbitrator")) return "/home";
  if (user.kycLevel === 0) return path === "/kyc" ? null : "/kyc";
  if (!user.hasPin) return path === "/setup-pin" ? null : "/setup-pin";
  return path === "/" || path === "/kyc" || path === "/setup-pin" ? "/home" : null;
}

/** Routes people to login → KYC → PIN setup (first time only) → home, and locks the app behind the PIN. */
export function AuthGate({ children }: { children: ReactNode }) {
  const ctx = useContext(Ctx)!;
  const { ready, user, unlocked, unlock, signOut, onMst } = ctx;
  const path = usePathname();
  const router = useRouter();
  const target = ready ? redirectFor(user, path) : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (!ready || target) return <Splash />;
  if (user?.hasPin && !unlocked)
    return (
      <LockScreen
        name={user.name ?? "Welcome back"}
        phone={user.phone}
        onUnlock={async (pin) => {
          await api.verifyPin(user.address, pin);
          unlock();
        }}
        onForgot={() => signOut()}
      />
    );
  return (
    <>
      {user && !onMst && (
        <p role="alert" className="sticky top-0 z-50 bg-warning px-4 py-2 text-center text-sm font-medium text-white">
          Your wallet is on another network. Switch it back to MST Testnet to sign or pay.
        </p>
      )}
      {children}
    </>
  );
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="h-10 w-10 animate-pulse rounded-2xl bg-accent" />
    </div>
  );
}
