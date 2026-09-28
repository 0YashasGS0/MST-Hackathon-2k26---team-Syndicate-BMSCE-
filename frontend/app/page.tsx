"use client";
// Landing page = login. Phone + OTP once per device. If the account is registered on another device, the
// security PIN is also required, the old device is removed and a 24 h cooling period starts (like UPI apps).
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { deviceAccount } from "@/lib/device-key";
import { useSession } from "@/components/session";
import { Logo } from "@/components/Header";
import { PinInput } from "@/components/Pin";
import { AlertIcon } from "@/components/icons";
import { Button, cx, inputCls } from "@/components/ui";

type Step = "phone" | "otp" | "device";

export default function LoginPage() {
  const { deviceId, signIn, notice } = useSession();
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const validPhone = /^[6-9]\d{9}$/.test(phone);

  async function sendOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api.requestOtp(phone);
      setStep("otp");
      setResendIn(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.verifyOtp(phone, otp, deviceId, deviceAccount().address);
      if (r.status === "ok") return signIn(r.user);
      setStep("device");
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setOtp("");
      setBusy(false);
    }
  }

  async function confirmDevice(p: string) {
    setBusy(true);
    setError(undefined);
    try {
      signIn(await api.verifyNewDevice(phone, deviceId, p));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPin("");
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* brand panel: top banner on phones, left half on laptops */}
      <section className="hero-gradient flex flex-col justify-between px-6 pb-10 pt-12 text-white sm:px-10 lg:p-14">
        <span className="rounded-2xl self-start bg-white px-3 py-2 text-[#16161a]">
          <Logo />
        </span>
        <div className="mt-10 lg:mt-0">
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            Pay for work. Release only when it&apos;s done.
          </h1>
          <p className="mt-3 max-w-md text-base opacity-90">
            Your money is held safely until you&apos;re happy with the work. If something goes wrong, raise a complaint
            and get a fair resolution.
          </p>
        </div>
        <ul className="mt-8 hidden space-y-2 text-sm opacity-90 lg:block">
          <li>✓ Pay with any UPI app</li>
          <li>✓ Money is released only with your approval</li>
          <li>✓ Fair, tamper-proof complaint resolution</li>
        </ul>
      </section>

      <section className="flex items-start justify-center px-6 py-10 sm:px-10 lg:items-center">
        <div className="w-full max-w-sm">
          {notice && <p className="mb-6 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">{notice}</p>}

          {step === "phone" ? (
            <form onSubmit={sendOtp} className="space-y-5">
              <div>
                <h2 className="text-2xl font-semibold">Enter your mobile number</h2>
                <p className="mt-1 text-sm text-muted">We&apos;ll send an OTP to verify it.</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-xl border border-line bg-surface-2 px-3.5 py-3 text-base sm:text-sm">+91</span>
                <input
                  autoFocus
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  className={inputCls + " tracking-wider"}
                  placeholder="98765 43210"
                />
              </div>
              <Button size="lg" className="w-full" disabled={!validPhone || busy}>
                {busy ? "Sending OTP…" : "Get OTP"}
              </Button>
              <p className="text-xs text-muted">
                Your account will be registered to this device. Moving it to another device needs your OTP and security PIN.
              </p>
            </form>
          ) : step === "device" ? (
            <div className="space-y-5">
              <div>
                <span className="grid h-12 w-12 place-items-center rounded-2xl bg-warning/10 text-warning">
                  <AlertIcon className="h-6 w-6" />
                </span>
                <h2 className="mt-4 text-2xl font-semibold">New device detected</h2>
                <p className="mt-1 text-sm text-muted">
                  Your account is registered on another device. Enter your security PIN to move it here.
                </p>
              </div>
              <ul className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm">
                <li>• Your other device will be logged out and removed</li>
                <li>• For 24 hours, payments above ₹5,000 are paused on this device</li>
                <li>• If this wasn&apos;t you, don&apos;t continue and contact support</li>
              </ul>
              <PinInput value={pin} onChange={setPin} onComplete={confirmDevice} error={!!error} />
              <p className={cx("text-center text-sm", busy ? "text-muted" : "invisible")}>Verifying…</p>
              <button
                type="button"
                className="w-full text-center text-sm font-medium text-muted hover:text-foreground"
                onClick={() => (setStep("phone"), setOtp(""), setPin(""), setError(undefined))}
              >
                Cancel
              </button>
            </div>
          ) : (
            <form onSubmit={verify} className="space-y-5">
              <div>
                <h2 className="text-2xl font-semibold">Enter OTP</h2>
                <p className="mt-1 text-sm text-muted">
                  Sent to +91 {phone}.{" "}
                  <button type="button" className="font-medium text-accent" onClick={() => (setStep("phone"), setOtp(""))}>
                    Change
                  </button>
                </p>
              </div>
              <input
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                className={inputCls + " text-center text-2xl tracking-[0.6em] sm:text-2xl"}
                placeholder="••••••"
              />
              <Button size="lg" className="w-full" disabled={otp.length !== 6 || busy}>
                {busy ? "Verifying…" : "Verify & continue"}
              </Button>
              <p className="text-center text-sm text-muted">
                {resendIn > 0 ? (
                  `Resend OTP in 0:${String(resendIn).padStart(2, "0")}`
                ) : (
                  <button type="button" className="font-medium text-accent" onClick={sendOtp}>
                    Resend OTP
                  </button>
                )}
              </p>
              {/* Demo only until PG wires SARAL OTP. */}
              <p className="text-center text-xs text-muted">Demo OTP: 123456</p>
            </form>
          )}

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        </div>
      </section>
    </div>
  );
}
