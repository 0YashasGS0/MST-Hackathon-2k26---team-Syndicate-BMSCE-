"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseUnits } from "viem";
import { api } from "@/lib/api";
import { USD_DECIMALS } from "@/lib/contracts";
import { Button, Card, Field, inputCls, PageHeader } from "@/components/ui";

export default function NewDealPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const draft = await api.createDraft({
        seller: String(f.get("seller")),
        purpose: String(f.get("purpose")),
        price: parseUnits(String(f.get("price")), USD_DECIMALS).toString(),
        buyerConstraints: String(f.get("constraints")),
      });
      router.push(`/drafts/${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New deal" subtitle="You're the buyer. The seller adds their points next, then AI drafts the SOW." />
      <Card>
        <form onSubmit={submit} className="space-y-5">
          <Field label="Seller" hint="Wallet address or handle">
            <input name="seller" required className={inputCls} placeholder="0x… or @handle" />
          </Field>
          <Field label="What are you paying for?">
            <input name="purpose" required className={inputCls} placeholder="e.g. Landing page for my bakery" />
          </Field>
          <Field label="Price (mUSD)" hint="Paid later via UPI; held by the escrow contract until release">
            <input name="price" required type="number" min="0.01" step="0.01" className={inputCls} placeholder="100.00" />
          </Field>
          <Field label="Your requirements" hint="Deadlines, must-haves, quality bar. The AI turns these into deliverables.">
            <textarea name="constraints" required rows={5} className={inputCls} placeholder="Must work on mobile. Done within 5 days…" />
          </Field>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button disabled={busy}>{busy ? "Creating…" : "Create draft & invite seller"}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
