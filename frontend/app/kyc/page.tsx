"use client";
// First-time only: AuthGate routes here until kycLevel > 0, and never again after.
import { useState } from "react";
import { api } from "@/lib/api";
import { useSession, useUser } from "@/components/session";
import { Logo } from "@/components/Header";
import { Button, Card, Field, inputCls, Screen } from "@/components/ui";

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
      form.set("phone", user.phone);
      updateUser(await api.submitKyc(form)); // AuthGate then moves on to /home
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <button onClick={() => signOut()} className="text-sm text-muted hover:text-foreground">
            Log out
          </button>
        </div>
      </header>

      <Screen className="pt-8">
        <p className="text-sm font-medium text-accent">One-time setup</p>
        <h1 className="mt-1 text-2xl font-semibold">Verify your identity</h1>
        <p className="mt-1 text-sm text-muted">
          Needed once so everyone you pay, or get paid by, is a verified person. It takes a minute.
        </p>

        <Card className="mt-6">
          <form onSubmit={submit} className="space-y-5">
            <Field label="Full name" hint="As on your ID">
              <input name="name" required autoComplete="name" className={inputCls} placeholder="Priya Sharma" />
            </Field>
            <Field label="PAN number">
              <input
                name="pan"
                required
                maxLength={10}
                pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]"
                title="10 characters, e.g. ABCDE1234F"
                className={inputCls + " uppercase tracking-wider"}
                placeholder="ABCDE1234F"
              />
            </Field>
            <div>
              <span className="mb-1.5 block text-sm font-medium">ID document</span>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line p-4 hover:bg-surface-2">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-accent/15 text-accent">↑</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{fileName ?? "Upload Aadhaar, PAN or passport"}</span>
                  <span className="block text-xs text-muted">Photo or PDF</span>
                </span>
                <input
                  name="file"
                  type="file"
                  required
                  accept="image/*,application/pdf"
                  className="sr-only"
                  onChange={(e) => setFileName(e.target.files?.[0]?.name)}
                />
              </label>
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button size="lg" className="w-full" disabled={busy}>
              {busy ? "Verifying…" : "Submit & continue"}
            </Button>
          </form>
        </Card>
      </Screen>
    </>
  );
}
