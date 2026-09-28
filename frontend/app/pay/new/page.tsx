"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { parseUnits } from "viem";
import { api } from "@/lib/api";
import { USD_DECIMALS } from "@/lib/contracts";
import { INR_PER_USD } from "@/lib/format";
import type { Party } from "@/lib/types";
import { BackBar, Button, Card, cx, Field, inputCls, Screen } from "@/components/ui";

const copy = {
  buyer: {
    person: "Pay to",
    personHint: "Mobile number or name of the person you're paying",
    amountHint: "Held safely until you approve the work",
    terms: "What should be delivered?",
    termsHint: "Deadline, must-haves, quality. We turn this into a clear agreement.",
    termsPlaceholder: "Must work on mobile. Done within 5 days. Include an order form.",
  },
  seller: {
    person: "Request from",
    personHint: "Mobile number or name of the person who will pay you",
    amountHint: "They pay now; you receive it once they approve the work",
    terms: "What will you deliver?",
    termsHint: "Scope, timeline, what's not included. We turn this into a clear agreement.",
    termsPlaceholder: "Landing page with menu and order form. 7 days. Hosting not included.",
  },
};

export default function NewPaymentPage() {
  const router = useRouter();
  const [role, setRole] = useState<Party>("buyer");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const t = copy[role];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const draft = await api.createDraft({
        role,
        counterparty: String(f.get("counterparty")),
        purpose: String(f.get("purpose")),
        price: parseUnits((Number(amount) / INR_PER_USD).toFixed(USD_DECIMALS), USD_DECIMALS).toString(),
        terms: String(f.get("terms")),
      });
      router.push(`/pay/agreement/${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <>
      <BackBar href="/home" title="Initiate payment" />
      <Screen className="pt-6">
        <div role="radiogroup" aria-label="I am" className="grid grid-cols-2 rounded-full border border-line bg-surface p-1">
          {(
            [
              ["buyer", "I'm paying"],
              ["seller", "I'm getting paid"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={role === value}
              onClick={() => setRole(value)}
              className={cx(
                "rounded-full py-2.5 text-sm font-semibold transition",
                role === value ? "bg-accent text-accent-fg shadow-sm" : "text-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <Card>
            <p className="text-center text-sm text-muted">{role === "buyer" ? "Amount to pay" : "Amount to receive"}</p>
            <div className="mt-1 flex items-center justify-center text-4xl font-semibold sm:text-5xl">
              <span className="mr-1 text-muted">₹</span>
              <input
                autoFocus
                required
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                placeholder="0"
                aria-label="Amount in rupees"
                style={{ width: `${Math.max(amount.length, 1) + 0.5}ch` }}
                className="max-w-[10ch] bg-transparent outline-none placeholder:text-line"
              />
            </div>
            <p className="mt-2 text-center text-xs text-muted">{t.amountHint}</p>
          </Card>

          <Card className="space-y-5">
            <Field label={t.person} hint={t.personHint}>
              <input name="counterparty" required className={inputCls} placeholder="98765 43210 or Ravi Kumar" />
            </Field>
            <Field label="What is this payment for?">
              <input name="purpose" required className={inputCls} placeholder="e.g. Landing page for a bakery" />
            </Field>
            <Field label={t.terms} hint={t.termsHint}>
              <textarea name="terms" required rows={4} className={inputCls} placeholder={t.termsPlaceholder} />
            </Field>
          </Card>

          {error && <p className="text-sm text-danger">{error}</p>}
          <Button size="lg" className="w-full" disabled={busy || !(Number(amount) > 0)}>
            {busy ? "Sending…" : role === "buyer" ? "Continue" : "Request payment"}
          </Button>
        </form>
      </Screen>
    </>
  );
}
