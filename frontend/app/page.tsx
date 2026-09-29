"use client";
// Landing page = login with a wallet (PG's sign-in: nonce → wallet signature → session cookie). If the account is
// registered on another device, the security PIN is also required, the old device is removed and a 24 h cooling
// period starts (like UPI apps). Browsers without MetaMask/BridgeKey can use a demo wallet kept on this device.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { api } from "@/lib/api";
import { deviceAccount } from "@/lib/device-key";
import { listWallets, signInWithWallet, type InjectedWalletOption } from "@/lib/wallet";
import { useSession } from "@/components/session";
import { Logo } from "@/components/Header";
import { PinInput } from "@/components/Pin";
import { AlertIcon, WalletIcon } from "@/components/icons";
import { Button, cx } from "@/components/ui";

type Step = "connect" | "device";

export default function LoginPage() {
  const { deviceId, signIn, notice } = useSession();
  const [step, setStep] = useState<Step>("connect");
  const [wallets, setWallets] = useState<InjectedWalletOption[]>();
  const [address, setAddress] = useState<Address>();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string>(); // id of the wallet being used
  const [error, setError] = useState<string>();

  useEffect(() => {
    listWallets().then(setWallets, () => setWallets([]));
  }, []);

  async function connect(option?: InjectedWalletOption) {
    setBusy(option?.id ?? "demo");
    setError(undefined);
    try {
      const { user } = await signInWithWallet(option);
      const r = await api.bindDevice(user, deviceId, deviceAccount().address);
      if (r.status === "ok") return signIn(r.user);
      setAddress(user.address);
      setStep("device");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setBusy(undefined);
  }

  async function confirmDevice(p: string) {
    setBusy("pin");
    setError(undefined);
    try {
      signIn(await api.verifyNewDevice(address!, deviceId, p));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPin("");
      setBusy(undefined);
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

          {step === "connect" ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl font-semibold">Sign in with your wallet</h2>
                <p className="mt-1 text-sm text-muted">
                  Your wallet signs a one-time message to prove it&apos;s you. It doesn&apos;t cost anything or move money.
                </p>
              </div>
              {wallets === undefined ? (
                <p className="text-sm text-muted">Looking for wallets…</p>
              ) : (
                <div className="space-y-3">
                  {wallets.map((w) => (
                    <Button
                      key={w.id}
                      size="lg"
                      className="w-full"
                      disabled={!!busy}
                      onClick={() => connect(w)}
                    >
                      {w.info?.icon && (
                        // eslint-disable-next-line @next/next/no-img-element -- wallet-provided data URL
                        <img src={w.info.icon} alt="" className="mr-2 h-5 w-5" />
                      )}
                      {busy === w.id ? "Check your wallet…" : `Continue with ${w.name}`}
                    </Button>
                  ))}
                  <Button
                    size="lg"
                    variant={wallets.length ? "secondary" : "primary"}
                    className="w-full"
                    disabled={!!busy}
                    onClick={() => connect()}
                  >
                    <WalletIcon className="mr-2 h-5 w-5" />
                    {busy === "demo" ? "Signing in…" : "Use demo wallet on this device"}
                  </Button>
                  {!wallets.length && (
                    <p className="text-xs text-muted">No wallet found in this browser. Install MetaMask, or use the demo wallet.</p>
                  )}
                </div>
              )}
              <p className="text-xs text-muted">
                We&apos;ll switch your wallet to MST Testnet. Your account will be registered to this device; moving it to
                another device needs your security PIN.
              </p>
            </div>
          ) : (
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
                onClick={() => (api.logout().catch(() => {}), setStep("connect"), setPin(""), setError(undefined))}
              >
                Cancel
              </button>
            </div>
          )}

          {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        </div>
      </section>
    </div>
  );
}
