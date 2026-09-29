"use client";
// Landing page = sign in with BridgeKey/MetaMask wallet (EIP-6963) or a browser-local demo wallet.
// Flow: detect wallets → GET /auth/nonce → wallet signs messageToSign → POST /auth/verify → session cookie.
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { api } from "@/lib/api";
import { deviceAccount } from "@/lib/device-key";
import { listWallets, signInWithWallet, signInWithDemoAccount, type InjectedWalletOption } from "@/lib/wallet";
import { useSession } from "@/components/session";
import { Logo, TAGLINE } from "@/components/Header";
import { PinInput } from "@/components/Pin";
import { AlertIcon } from "@/components/icons";
import { Button, cx } from "@/components/ui";

type Step = "connect" | "device";

// BridgeKey SVG icon
const BridgeKeyIcon = () => (
  <svg width="20" height="20" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2 shrink-0">
    <rect width="32" height="32" rx="8" fill="#7C3AED"/>
    <path d="M8 16C8 11.582 11.582 8 16 8s8 3.582 8 8-3.582 8-8 8-8-3.582-8-8z" stroke="#fff" strokeWidth="2"/>
    <path d="M13 16h6M16 13v6" stroke="#fff" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

// MetaMask fox icon
const MetaMaskIcon = () => (
  <svg width="20" height="20" viewBox="0 0 35 33" xmlns="http://www.w3.org/2000/svg" className="mr-2 shrink-0">
    <g fill="none" fillRule="evenodd">
      <polygon fill="#E17726" points="32.958 1 19.148 10.616 21.621 4.471"/>
      <polygon fill="#E27625" points="2.042 1 15.72 10.709 13.38 4.471"/>
      <polygon fill="#E27625" points="28.065 23.212 24.286 28.913 32.204 31.078 34.4 23.335"/>
      <polygon fill="#E27625" points=".613 23.335 2.796 31.078 10.701 28.913 6.935 23.212"/>
      <polygon fill="#E27625" points="10.277 14.422 8.109 17.636 15.973 17.99 15.71 9.47"/>
      <polygon fill="#E27625" points="24.723 14.422 19.199 9.375 19.028 17.99 26.891 17.636"/>
      <polygon fill="#E27625" points="10.701 28.913 15.499 26.616 11.348 23.389"/>
      <polygon fill="#E27625" points="19.501 26.616 24.286 28.913 23.652 23.389"/>
    </g>
  </svg>
);

const WalletFallbackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2 shrink-0">
    <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z"/>
    <circle cx="16" cy="12" r="1" fill="currentColor"/>
    <path d="M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>
  </svg>
);

const ShieldIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <path d="m9 12 2 2 4-4"/>
  </svg>
);

function walletIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("bridgekey")) return <BridgeKeyIcon />;
  if (lower.includes("metamask")) return <MetaMaskIcon />;
  return <WalletFallbackIcon />;
}

export default function LoginPage() {
  const { deviceId, signIn, notice } = useSession();
  const [step, setStep] = useState<Step>("connect");
  const [wallets, setWallets] = useState<InjectedWalletOption[]>();
  const [address, setAddress] = useState<Address>();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState<string>();
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

  async function connectDemo(phone: string) {
    setBusy(`demo-${phone}`);
    setError(undefined);
    try {
      const { user } = await signInWithDemoAccount(phone);
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

  const demoAccounts = [
    { phone: "9000000001", label: "Priya Sharma", role: "Buyer" },
    { phone: "9000000002", label: "Ravi Kumar", role: "Seller" },
    { phone: "9000000009", label: "Arbitrator Desk", role: "Arbitrator" },
  ];

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* ── Left brand panel ───────────────────────────────────────────── */}
      <section className="hero-gradient relative flex flex-col justify-between overflow-hidden px-6 pb-10 pt-12 text-white sm:px-10 lg:p-14">
        {/* Decorative blob */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/5 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-20 h-72 w-72 rounded-full bg-white/5 blur-3xl" />

        <span className="relative z-10 self-start rounded-2xl bg-white px-3 py-2 text-[#16161a]">
          <Logo />
        </span>

        <div className="relative z-10 mt-10 lg:mt-0">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-medium backdrop-blur-sm">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-400" />
            Powered by MST Blockchain
          </div>
          <h1 className="max-w-md text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">
            {TAGLINE}
          </h1>
          <p className="mt-3 max-w-md text-base opacity-90">
            Your money is held safely until you&apos;re happy with the work. If something goes wrong,
            raise a complaint and get a fair resolution on-chain.
          </p>
        </div>

        <ul className="relative z-10 mt-8 hidden space-y-3 lg:block">
          {[
            "Pay with any UPI app — zero setup",
            "Funds released only with your approval",
            "AI-mediated dispute resolution on MST chain",
            "Your keys, your control — no custodian",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 text-sm opacity-90">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs">✓</span>
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Right sign-in panel ─────────────────────────────────────────── */}
      <section className="flex items-start justify-center px-6 py-10 sm:px-10 lg:items-center">
        <div className="w-full max-w-sm">
          {notice && (
            <p className="mb-6 rounded-xl bg-warning/10 px-4 py-3 text-sm text-warning">{notice}</p>
          )}

          {step === "connect" ? (
            <div className="space-y-6">
              {/* Header */}
              <div>
                <h2 className="text-2xl font-semibold">Connect your wallet</h2>
                <p className="mt-1 text-sm text-muted">
                  Sign in with BridgeKey or MetaMask to get started. No password needed.
                </p>
              </div>

              {/* Wallet buttons */}
              {wallets === undefined ? (
                <div className="flex items-center gap-2 text-sm text-muted">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  Detecting wallets…
                </div>
              ) : (
                <div className="space-y-3">
                  {wallets.length > 0 ? (
                    <>
                      {wallets.map((w) => (
                        <button
                          key={w.id}
                          id={`wallet-btn-${w.id.replace(/[^a-z0-9]/gi, "-")}`}
                          className={cx(
                            "flex w-full items-center justify-center rounded-2xl border border-line/60 bg-surface-2 px-4 py-3.5 text-sm font-medium transition-all",
                            "hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm active:scale-[0.98]",
                            busy === w.id && "opacity-60 pointer-events-none",
                          )}
                          disabled={!!busy}
                          onClick={() => connect(w)}
                        >
                          {w.info?.icon
                            ? <img src={w.info.icon} alt="" className="mr-2 h-5 w-5 shrink-0" />
                            : walletIcon(w.name)
                          }
                          {busy === w.id ? "Check your wallet…" : `Continue with ${w.name}`}
                        </button>
                      ))}

                      {/* Always also show Demo Wallet for testing */}
                      <button
                        id="wallet-btn-demo"
                        className={cx(
                          "flex w-full items-center justify-center rounded-2xl border border-line/40 bg-surface-2 px-4 py-3.5 text-sm font-medium text-muted transition-all",
                          "hover:border-line hover:text-foreground active:scale-[0.98]",
                          busy === "demo" && "opacity-60 pointer-events-none",
                        )}
                        disabled={!!busy}
                        onClick={() => connect()}
                      >
                        <WalletFallbackIcon />
                        {busy === "demo" ? "Generating…" : "Demo Wallet (this browser)"}
                      </button>
                    </>
                  ) : (
                    <>
                      {/* No injected wallet detected — show install prompt + demo wallet */}
                      <div className="rounded-2xl border border-dashed border-line bg-surface-2 p-5 text-center">
                        <p className="text-sm font-medium">No wallet detected</p>
                        <p className="mt-1 text-xs text-muted">
                          Install{" "}
                          <a
                            href="https://bridgekey.mstblockchain.com"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-primary underline-offset-2 hover:underline"
                          >
                            BridgeKey
                          </a>{" "}
                          (recommended) or{" "}
                          <a
                            href="https://metamask.io"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-primary underline-offset-2 hover:underline"
                          >
                            MetaMask
                          </a>{" "}
                          to connect your real wallet.
                        </p>
                      </div>

                      <button
                        id="wallet-btn-demo"
                        className={cx(
                          "flex w-full items-center justify-center rounded-2xl bg-primary px-4 py-3.5 text-sm font-semibold text-white transition-all",
                          "hover:opacity-90 active:scale-[0.98]",
                          busy === "demo" && "opacity-60 pointer-events-none",
                        )}
                        disabled={!!busy}
                        onClick={() => connect()}
                      >
                        <WalletFallbackIcon />
                        {busy === "demo" ? "Generating wallet…" : "Continue with Demo Wallet"}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Divider */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-line/40" />
                <span className="text-xs text-muted">or try a demo account</span>
                <div className="h-px flex-1 bg-line/40" />
              </div>

              {/* Demo accounts — now use real cryptographic signatures ✓ */}
              <div className="space-y-2">
                {demoAccounts.map(({ phone, label, role }) => (
                  <button
                    key={phone}
                    id={`demo-account-${phone}`}
                    className={cx(
                      "flex w-full items-center justify-between rounded-xl border border-line/40 px-4 py-3 text-sm transition-all",
                      "hover:border-line hover:bg-surface-2 active:scale-[0.99]",
                      busy === `demo-${phone}` && "opacity-60 pointer-events-none",
                    )}
                    disabled={!!busy}
                    onClick={() => connectDemo(phone)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                        {label[0]}
                      </span>
                      <div className="text-left">
                        <div className="font-medium">{label}</div>
                        <div className="text-xs text-muted">{role} · pre-seeded account</div>
                      </div>
                    </div>
                    {busy === `demo-${phone}` ? (
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-50" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                    )}
                  </button>
                ))}
              </div>

              {/* Trust footer */}
              <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
                <ShieldIcon />
                Signing costs nothing. We switch your wallet to MST Testnet automatically.
              </p>
            </div>
          ) : (
            /* ── Device PIN step ───────────────────────────────────────── */
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

          {error && (
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-danger/10 px-4 py-3 text-sm text-danger">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
              </svg>
              {error}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
