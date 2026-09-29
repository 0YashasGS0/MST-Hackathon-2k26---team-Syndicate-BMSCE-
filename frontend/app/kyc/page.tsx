"use client";
// First-time only: AuthGate routes here until kycLevel > 0, and never again after.
import { useState } from "react";
import { api } from "@/lib/api";
import { useSession, useUser } from "@/components/session";
import { Logo } from "@/components/Header";
import { CameraIcon, CheckIcon, DocIcon, LockIcon, PhoneIcon, UserIcon } from "@/components/icons";
import { bareInputCls, Button, Card, cx, IconField, Screen } from "@/components/ui";

export default function KycPage() {
  const user = useUser();
  const { updateUser, signOut } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [fileName, setFileName] = useState<string>();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const form = new FormData(e.currentTarget);
      updateUser(await api.submitKyc(user.address, form)); // AuthGate then moves on to /home
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
          <span className="inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">One-time setup</span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Verify your identity</h1>
          <p className="mt-2 max-w-md text-sm text-white/80">
            Needed once, so everyone you pay or get paid by is a verified person. Takes about a minute.
          </p>
        </div>
      </div>

      <Screen className="-mt-12">
        <form onSubmit={submit} className="space-y-4">
          <Card flush className="divide-y divide-line/70">
            <IconField icon={<UserIcon className="h-5 w-5" />} label="Full name (as on your ID)">
              <input name="name" required autoComplete="name" className={bareInputCls} placeholder="Priya Sharma" />
            </IconField>
            <IconField icon={<PhoneIcon className="h-5 w-5" />} label="Mobile number (people find you by it)">
              <input
                name="phone"
                required
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                pattern="[6-9][0-9]{9}"
                title="10-digit Indian mobile number"
                className={bareInputCls + " tracking-wider"}
                placeholder="98765 43210"
              />
            </IconField>
            <IconField icon={<DocIcon className="h-5 w-5" />} label="PAN number">
              <input
                name="pan"
                required
                maxLength={10}
                pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]"
                title="10 characters, e.g. ABCDE1234F"
                className={bareInputCls + " uppercase tracking-widest"}
                placeholder="ABCDE1234F"
              />
            </IconField>
            <label className="flex cursor-pointer items-center gap-3.5 px-5 py-4 transition hover:bg-surface-2/70 sm:px-6">
              <span
                className={cx(
                  "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
                  fileName ? "bg-success/10 text-success" : "bg-accent-soft text-accent",
                )}
              >
                {fileName ? <CheckIcon className="h-5 w-5" /> : <CameraIcon className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-medium text-muted">ID document</span>
                <span className="block truncate text-[15px] font-medium">{fileName ?? "Upload Aadhaar, PAN or passport"}</span>
              </span>
              <span className="text-sm font-semibold text-accent">{fileName ? "Change" : "Upload"}</span>
              <input
                name="file"
                type="file"
                required
                accept="image/*,application/pdf"
                className="sr-only"
                onChange={(e) => setFileName(e.target.files?.[0]?.name)}
              />
            </label>
          </Card>

          <p className="flex items-center justify-center gap-2 text-xs text-muted">
            <LockIcon className="h-4 w-4" />
            Your details are encrypted and used only for verification
          </p>
          {error && <p className="text-center text-sm text-danger">{error}</p>}
          <Button size="lg" className="w-full" disabled={busy}>
            {busy ? "Verifying…" : "Submit & continue"}
          </Button>
        </form>
      </Screen>
    </>
  );
}
