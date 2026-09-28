"use client";
// One-time: choose the security PIN used to unlock the app, move to a new device, sign and release money.
import { useState } from "react";
import { api } from "@/lib/api";
import { useSession, useUser } from "@/components/session";
import { Logo } from "@/components/Header";
import { PIN_LENGTH, PinInput } from "@/components/Pin";
import { LockIcon } from "@/components/icons";
import { Card, cx, Screen } from "@/components/ui";

export default function SetupPinPage() {
  const user = useUser();
  const { deviceId, updateUser, signOut } = useSession();
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [step, setStep] = useState<"choose" | "confirm">("choose");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function confirm(pin: string) {
    if (pin !== first) {
      setError("PINs don't match. Choose your PIN again.");
      setFirst("");
      setSecond("");
      setStep("choose");
      return;
    }
    setBusy(true);
    try {
      updateUser(await api.setPin(user.phone, deviceId, pin)); // AuthGate then moves on to /home
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Already set on the server (e.g. set earlier or on another screen): sync and move on to the lock screen.
      const fresh = await api.getMe(user.phone).catch(() => null);
      if (fresh?.hasPin) return updateUser({ ...user, ...fresh, deviceId });
      setError(msg);
      setFirst("");
      setSecond("");
      setStep("choose");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero-gradient pb-20 text-white">
        <header className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Logo onDark />
          <button onClick={() => signOut()} className="text-sm text-white/75 hover:text-white">
            Log out
          </button>
        </header>
        <div className="mx-auto max-w-2xl px-5 pt-4 sm:px-7">
          <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">Last step</span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Set your security PIN</h1>
          <p className="mt-2 max-w-md text-sm text-white/80">
            You&apos;ll use it to open the app, sign agreements, release money, and to move your account to a new phone.
          </p>
        </div>
      </div>

      <Screen className="-mt-12">
        <Card className="text-center">
          <p className="text-sm font-semibold">{step === "choose" ? "Choose a 4-digit PIN" : "Enter the same PIN again"}</p>
          <div className="mt-5">
            {step === "choose" ? (
              <PinInput
                key="choose"
                value={first}
                onChange={(v) => (setFirst(v), setError(undefined))}
                onComplete={() => setStep("confirm")}
                error={!!error}
              />
            ) : (
              <PinInput key="confirm" value={second} onChange={setSecond} onComplete={confirm} />
            )}
          </div>
          <p className={cx("mt-4 min-h-5 text-sm", error ? "text-danger" : "text-muted")}>
            {busy ? "Saving…" : error ?? (step === "choose" ? `Don't use repeated or sequential digits` : `${second.length}/${PIN_LENGTH}`)}
          </p>
        </Card>
        <p className="mt-4 flex items-start justify-center gap-2 px-2 text-center text-xs text-muted">
          <LockIcon className="mt-0.5 h-4 w-4 shrink-0" />
          Never share your PIN. Sakshi staff will never ask for it.
        </p>
      </Screen>
    </>
  );
}
