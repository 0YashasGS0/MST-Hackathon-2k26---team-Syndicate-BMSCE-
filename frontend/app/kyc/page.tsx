"use client";
import { useEffect, useState } from "react";
import { useSession } from "@/components/session";
import { api } from "@/lib/api";
import type { User } from "@/lib/types";
import { Badge, Button, Card, Field, inputCls, MockNote, PageHeader, TxLink } from "@/components/ui";

const levels = [
  { level: 0, label: "Not verified", tone: "neutral" as const },
  { level: 1, label: "Level 1 · documents submitted", tone: "info" as const },
  { level: 2, label: "Level 2 · approved on-chain", tone: "success" as const },
];

export default function KycPage() {
  const { address } = useSession();
  const [user, setUser] = useState<User>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (address) api.getUser(address).then(setUser);
  }, [address]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!address) return;
    setBusy(true);
    const form = new FormData(e.currentTarget);
    form.set("address", address);
    setUser(await api.submitKyc(form));
    setBusy(false);
  }

  const lvl = levels[user?.kycLevel ?? 0];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Verify your identity" subtitle="Required before you can create or accept a deal." />

      <Card title="Status" actions={<Badge tone={lvl.tone}>{lvl.label}</Badge>}>
        <ol className="space-y-2 text-sm">
          <li>1. Upload an ID document (mock — any file works).</li>
          <li>2. An admin approves it; the approval is written on MST via <code>setKyc</code>.</li>
        </ol>
        {user?.kycTx && (
          <p className="mt-3 text-sm">
            Approval transaction: <TxLink hash={user.kycTx} />
          </p>
        )}
      </Card>

      <Card title="Submit documents" className="mt-4">
        {!address ? (
          <p className="text-sm text-muted">Connect your wallet first.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <Field label="Full name">
              <input name="name" required className={inputCls} placeholder="As on your ID" />
            </Field>
            <Field label="Phone">
              <input name="phone" required className={inputCls} placeholder="+91…" />
            </Field>
            <Field label="ID document" hint="PDF or image">
              <input name="file" type="file" required className="text-sm" />
            </Field>
            <Button disabled={busy || (user?.kycLevel ?? 0) >= 1}>{busy ? "Uploading…" : "Submit for review"}</Button>
          </form>
        )}
        <MockNote>submission is stored in memory; Level 2 needs the admin approve endpoint (B1).</MockNote>
      </Card>
    </div>
  );
}
