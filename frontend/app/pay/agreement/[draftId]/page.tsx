"use client";
// Both sides' terms → AI-drafted agreement → agree → pay.
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtInr } from "@/lib/format";
import type { Draft, SowVersion } from "@/lib/types";
import { useUser } from "@/components/session";
import { SowList } from "@/components/SowList";
import { Avatar, BackBar, Button, Card, Loading, Screen, SectionTitle } from "@/components/ui";

export default function AgreementPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const user = useUser();
  const [draft, setDraft] = useState<Draft>();
  const [sow, setSow] = useState<SowVersion | null>(null);
  const [busy, setBusy] = useState<"merge" | "agree">();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.getDraft(draftId).then(setDraft, (e) => setError(e instanceof Error ? e.message : String(e)));
    api.getSow(draftId).then(setSow);
  }, [draftId]);

  async function run(label: "merge" | "agree", fn: () => Promise<void>) {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  const prepare = () => run("merge", async () => setSow(await api.mergeSow(draftId)));
  const agree = () =>
    run("agree", async () => {
      await api.approveSow(draftId, iAmBuyer ? "buyer" : "seller", sow!.version);
      const { dealId } = await api.startDeal(draftId);
      // The payer goes straight to paying; the receiver waits for the payer to fund.
      router.push(iAmBuyer ? `/txn/${dealId}/pay` : `/txn/${dealId}`);
    });

  const iAmBuyer = draft?.buyer.toLowerCase() === user.address.toLowerCase();
  const other = draft ? (iAmBuyer ? draft.sellerName : draft.buyerName) : "";
  const mine = iAmBuyer ? draft?.buyerConstraints : draft?.sellerPoints;
  const theirs = iAmBuyer ? draft?.sellerPoints : draft?.buyerConstraints;

  return (
    <>
      <BackBar href="/home" title="Agree on the work" />
      {!draft ? (
        error ? <p className="p-6 text-center text-danger">{error}</p> : <Loading />
      ) : (
        <Screen className="pt-6">
          <div className="flex flex-col items-center text-center">
            <Avatar name={other} size="lg" />
            <p className="mt-2 text-sm text-muted">{iAmBuyer ? `Paying ${other}` : `Requesting from ${other}`}</p>
            <p className="text-4xl font-semibold">{fmtInr(draft.price)}</p>
            <p className="mt-1 text-sm text-muted">{draft.purpose}</p>
          </div>

          <SectionTitle>What each side said</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <Card>
              <p className="text-xs font-medium text-muted">You</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{mine}</p>
            </Card>
            <Card>
              <p className="text-xs font-medium text-muted">{other}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {theirs ?? <span className="text-muted">Waiting for their reply…</span>}
              </p>
            </Card>
          </div>

          <SectionTitle>Agreement</SectionTitle>
          {!sow ? (
            <Card className="text-center">
              <p className="text-sm text-muted">We&apos;ll combine both sides into one clear list of what gets delivered.</p>
              <Button className="mt-4" onClick={prepare} disabled={!theirs || !!busy}>
                {busy === "merge" ? "Preparing agreement…" : "Prepare agreement"}
              </Button>
            </Card>
          ) : (
            <>
              {sow.conflicts.length > 0 && (
                <div className="mb-3 rounded-2xl bg-warning/10 p-4 text-sm">
                  <p className="font-medium text-warning">Where you differed</p>
                  <ul className="mt-1 space-y-1">
                    {sow.conflicts.map((c) => (
                      <li key={c.field}>
                        <b>{c.field}:</b> you said {c.buyer}, they said {c.seller}
                        {c.note && <span className="text-muted"> — {c.note}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Card>
                <SowList sow={sow.sow} />
              </Card>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row-reverse">
                <Button size="lg" className="flex-1" onClick={agree} disabled={!!busy}>
                  {busy === "agree" ? "Confirming…" : iAmBuyer ? `Agree & pay ${fmtInr(draft.price)}` : "Agree & send request"}
                </Button>
                <Button size="lg" variant="secondary" onClick={prepare} disabled={!!busy}>
                  {busy === "merge" ? "Preparing…" : "Redo agreement"}
                </Button>
              </div>
            </>
          )}
          {error && <p className="mt-4 text-sm text-danger">{error}</p>}
        </Screen>
      )}
    </>
  );
}
