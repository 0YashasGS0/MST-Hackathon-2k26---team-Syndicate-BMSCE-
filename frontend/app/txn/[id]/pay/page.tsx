"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtInr, txnId } from "@/lib/format";
import type { OnrampSession } from "@/lib/types";
import { useDeal } from "@/components/useDeal";
import { Avatar, BackBar, Button, ButtonLink, Card, Loading, Screen } from "@/components/ui";

type Step = "ready" | "paying" | "done";

export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const { deal } = useDeal(id);
  const [session, setSession] = useState<OnrampSession>();
  const [step, setStep] = useState<Step>("ready");
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.onrampSession(id).then(setSession, (e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  async function confirmPaid() {
    setStep("paying");
    setError(undefined);
    try {
      await api.onrampConfirm(id);
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("ready");
    }
  }

  if (!deal || !session)
    return (
      <>
        <BackBar href="/home" title="Pay" />
        {error ? <p className="p-6 text-center text-danger">{error}</p> : <Loading />}
      </>
    );

  if (step === "done")
    return (
      <Screen className="flex min-h-dvh flex-col items-center justify-center text-center">
        <div className="grid h-24 w-24 place-items-center rounded-full bg-success text-5xl text-white">✓</div>
        <p className="mt-6 text-4xl font-semibold">{fmtInr(deal.amount)}</p>
        <p className="mt-1 text-muted">paid for {deal.title}</p>
        <Card className="mt-6 w-full max-w-sm text-left">
          <p className="text-sm">
            Your money is <b>held safely</b>. {deal.sellerName} gets it only after you confirm the work is done.
          </p>
          <p className="mt-3 text-xs text-muted">Transaction ID · <span className="font-mono">{txnId(deal.id)}</span></p>
        </Card>
        <ButtonLink size="lg" href="/home" className="mt-8 w-full max-w-sm">
          Done
        </ButtonLink>
      </Screen>
    );

  return (
    <>
      <BackBar href={`/txn/${id}`} title="Pay" />
      <Screen className="pt-8">
        <div className="flex flex-col items-center text-center">
          <Avatar name={deal.sellerName} size="lg" />
          <p className="mt-2 text-sm text-muted">Paying {deal.sellerName}</p>
          <p className="mt-1 text-5xl font-semibold">{fmtInr(deal.amount)}</p>
          <p className="mt-1 text-sm text-muted">{deal.title}</p>
        </div>

        <Card className="mt-8 text-center">
          <p className="text-sm font-medium">Scan with any UPI app</p>
          {/* TODO(FE): render session.upiUri as a real QR once PG's on-ramp is live. */}
          <div className="mx-auto my-4 grid h-48 w-48 place-items-center rounded-2xl border-2 border-dashed border-line text-xs text-muted">
            UPI QR
          </div>
          <div className="flex flex-col gap-2 sm:hidden">
            <Button variant="secondary" onClick={() => (window.location.href = session.upiUri)}>
              Open UPI app
            </Button>
          </div>
        </Card>

        <Button size="lg" className="mt-6 w-full" onClick={confirmPaid} disabled={step === "paying"}>
          {step === "paying" ? "Confirming payment…" : "I've paid"}
        </Button>
        {error && <p className="mt-3 text-center text-sm text-danger">{error}</p>}
        <p className="mt-4 text-center text-xs text-muted">
          Your money is held safely and released only when you approve the work.
        </p>
      </Screen>
    </>
  );
}
