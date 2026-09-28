"use client";
// Device-bound session, UPI style: sign in once with phone + OTP, stay signed in on this device.
// The SARAL MPC wallet behind the account is never shown. Signing in on another device takes over
// the account; this device finds out on its next launch via checkDevice and signs out.
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";

type Session = {
  ready: boolean;
  user?: User;
  deviceId: string;
  notice?: string;
  signIn: (u: User) => void;
  updateUser: (patch: Partial<User>) => void;
  signOut: (notice?: string) => void;
};

const USER_KEY = "fe.session.user";
const DEVICE_KEY = "fe.device.id";

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {}
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User>();
  const [deviceId, setDeviceId] = useState("");
  const [notice, setNotice] = useState<string>();

  useEffect(() => {
    let id = read(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID();
      write(DEVICE_KEY, id);
    }
    let saved: User | undefined;
    try {
      saved = JSON.parse(read(USER_KEY) ?? "null") ?? undefined;
    } catch {}
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from storage */
    setDeviceId(id);
    setUser(saved);
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (saved) {
      api.checkDevice(saved.phone, id).then(({ valid }) => {
        if (valid) return;
        write(USER_KEY, null);
        setUser(undefined);
        setNotice("Your account was registered on another device, so you were signed out here.");
      });
    }
  }, []);

  const signIn = useCallback((u: User) => {
    write(USER_KEY, JSON.stringify(u));
    setNotice(undefined);
    setUser(u);
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, ...patch };
      write(USER_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const signOut = useCallback((n?: string) => {
    write(USER_KEY, null);
    setNotice(n);
    setUser(undefined);
  }, []);

  return (
    <Ctx.Provider value={{ ready, user, deviceId, notice, signIn, updateUser, signOut }}>{children}</Ctx.Provider>
  );
}

export function useSession() {
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

/** Routes people to login → KYC (first time only) → home, and hides pages until that's settled. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, user } = useSession();
  const path = usePathname();
  const router = useRouter();

  const target = !ready
    ? null
    : !user
      ? path === "/" ? null : "/"
      : user.kycLevel === 0
        ? path === "/kyc" ? null : "/kyc"
        : path === "/" || path === "/kyc" ? "/home" : null;

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  if (!ready || target) return <Splash />;
  return <>{children}</>;
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <div className="h-10 w-10 animate-pulse rounded-2xl bg-accent" />
    </div>
  );
}
