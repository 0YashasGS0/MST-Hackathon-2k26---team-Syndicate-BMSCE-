"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { OnrampConfirm, OnrampSession } from "@/lib/types";
import { Button, Card, MockNote, PageHeader, TxLink } from "@/components/ui";

type Step = "ready" | "paying" | "done";

export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<OnrampSession>();
  const [step, setStep] = useState<Step>("ready");
  const [result, setResult] = useState<OnrampConfirm>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.onrampSession(id).then(setSession, (e) => setError(String(e)));
  }, [id]);

  async function pay() {
    setStep("paying");
    setError(undefined);
    try {
      setResult(await api.onrampConfirm(id));
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("ready");
    }
  }

  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Fund the escrow" subtitle={`Deal #${id}`} />
      <Card>
        {!session ? (
          <p className="text-sm text-muted">{error ?? "Preparing payment…"}</p>
        ) : step !== "done" ? (
          <div className="text-center">
            <p className="text-sm text-muted">Amount to pay</p>
            <p className="mt-1 text-4xl font-semibold">₹{session.amountInr}</p>
            <p className="mt-1 text-sm text-muted">= {session.amountUsd} mUSD, locked in the contract</p>

            {/* QR placeholder */}
            <div className="mx-auto my-6 grid h-44 w-44 place-items-center rounded-xl border-2 border-dashed border-line text-xs text-muted">
              UPI QR
            </div>

            <Button className="w-full" onClick={pay} disabled={step === "paying"}>
              {step === "paying" ? "Confirming payment…" : "I've paid with UPI"}
            </Button>
            {error && <p className="mt-3 text-sm text-danger">{error}</p>}
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-lg font-semibold text-success">✓ Escrow funded</p>
            <ol className="space-y-3 text-sm">
              <li className="flex items-center justify-between">
                <span>1. mUSD minted for your payment</span>
                {result && <TxLink hash={result.mintTx} />}
              </li>
              <li className="flex items-center justify-between">
                <span>2. Locked in the escrow contract</span>
                {result && <TxLink hash={result.fundTx} />}
              </li>
            </ol>
            <Link href={`/deals/${id}`} className="block text-center text-sm text-accent hover:underline">
              Back to deal →
            </Link>
          </div>
        )}
        <MockNote>PG&apos;s on-ramp; the real flow mints then calls fundFor. Clicking twice must fund once.</MockNote>
      </Card>
    </div>
  );
}
