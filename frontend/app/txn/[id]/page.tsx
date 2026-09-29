"use client";
// Transaction details, shown only when a row is tapped (GPay style).
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CAN_COMPLAIN, COMPLAINT_OPEN, fmtDateTime, fmtInr, initiatedAt, isSettled, releasedAt, txnId } from "@/lib/format";
import { verifySignature } from "@/lib/agreement";
import type { SowVersion } from "@/lib/types";
import { useUser } from "@/components/session";
import { useDeal } from "@/components/useDeal";
import { SowList } from "@/components/SowList";
import { PinSheet } from "@/components/Pin";
import { CheckIcon, ChevronRight, CopyIcon, DocIcon, LockIcon } from "@/components/icons";
import { Avatar, BackBar, Button, ButtonLink, Card, inputCls, Loading, Row, Screen, StatusChip } from "@/components/ui";

export default function TxnPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const { deal, error, reload } = useDeal(id);
  const [agreement, setAgreement] = useState<SowVersion | null>();
  const [sigsOk, setSigsOk] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const [askPin, setAskPin] = useState(false);

  useEffect(() => {
    api.getAgreement(id).then(async (a) => {
      setAgreement(a);
      if (a) setSigsOk(a.signatures.length === 2 && (await Promise.all(a.signatures.map((s) => verifySignature(a.sow, s)))).every(Boolean));
    });
  }, [id]);

  // Pick up the other party's actions (payment, delivery, complaint) while this screen is open.
  useEffect(() => {
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);

  if (!deal) return (<><BackBar href="/home" />{error ? <p className="p-6 text-center text-danger">{error}</p> : <Loading />}</>);

  const iAmBuyer = deal.buyer.toLowerCase() === user.address.toLowerCase();
  const other = iAmBuyer ? deal.sellerName : deal.buyerName;
  const settled = isSettled(deal);
  const released = releasedAt(deal);
  const base = `/txn/${deal.id}`;
  const heading = settled ? (iAmBuyer ? `Paid to ${other}` : `Received from ${other}`) : iAmBuyer ? `Paying ${other}` : `From ${other}`;
  const toBuyer = deal.buyerBps ? (BigInt(deal.amount) * BigInt(deal.buyerBps)) / 10000n : 0n;
  const splitSettled = settled && deal.status !== "Released" && deal.buyerBps !== undefined;

  async function deliver() {
    setBusy(true);
    await api.markDelivered(deal!.id, note.trim());
    await reload();
    setBusy(false);
  }

  async function release(pin: string) {
    await api.release(deal!.id, pin);
    setAskPin(false);
    await reload();
  }

  function copyId() {
    navigator.clipboard?.writeText(txnId(deal!.id)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <>
      <BackBar href="/home" title="Transaction details" />
      <Screen className="pt-6">
        {/* receipt */}
        <Card flush>
          <div className="flex flex-col items-center px-6 pb-6 pt-8 text-center">
            <div className="relative">
              <Avatar name={other} size="lg" />
              {settled && (
                <span className="absolute -bottom-1 -right-1 grid h-7 w-7 place-items-center rounded-full bg-success text-white ring-4 ring-surface">
                  <CheckIcon className="h-4 w-4" strokeWidth={2.5} />
                </span>
              )}
            </div>
            <p className="mt-4 text-sm text-muted">{heading}</p>
            <p className="num mt-1 text-5xl font-semibold">{fmtInr(deal.amount)}</p>
            <p className="mt-1.5 text-sm text-muted">{deal.title}</p>
            <div className="mt-4">
              <StatusChip status={deal.status} />
            </div>
          </div>
          <dl className="divide-y divide-line/70 border-t border-dashed border-line px-5 sm:px-6">
            <Row label="Transaction ID">
              <button onClick={copyId} className="inline-flex items-center gap-1.5 font-mono hover:text-accent" title="Copy">
                {txnId(deal.id)}
                {copied ? <CheckIcon className="h-4 w-4 text-success" /> : <CopyIcon className="h-4 w-4 text-muted" />}
              </button>
            </Row>
            <Row label="Initiated on">{fmtDateTime(initiatedAt(deal))}</Row>
            <Row label="Released on">
              {released ? fmtDateTime(released) : <span className="font-normal text-muted">Not released yet</span>}
            </Row>
          </dl>
        </Card>

        {splitSettled && (
          <Card className="mt-4">
            <p className="text-sm font-semibold">Settled after a complaint</p>
            <dl className="mt-1 divide-y divide-line/70">
              <Row label={iAmBuyer ? "Refunded to you" : `Refunded to ${other}`}>{fmtInr(toBuyer)}</Row>
              <Row label={iAmBuyer ? `Paid to ${other}` : "Paid to you"}>{fmtInr(BigInt(deal.amount) - toBuyer)}</Row>
            </dl>
            <ButtonLink variant="soft" size="sm" className="mt-2" href={`${base}/resolution`}>
              View complaint details
            </ButtonLink>
          </Card>
        )}

        <Card className="mt-4" flush>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center gap-3.5 px-5 py-4 sm:px-6">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">
                <DocIcon className="h-5 w-5" />
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-semibold tracking-tight">Agreement</span>
                <span className="block text-[13px] text-muted">
                  {sigsOk === undefined ? "What was agreed to be delivered" : sigsOk ? "Signed by both · verified" : "Signatures don't match"}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-muted transition group-open:rotate-90" />
            </summary>
            <div className="border-t border-line/70 p-5 sm:p-6">{agreement ? (
                <>
                  <SowList sow={agreement.sow} />
                  <p className="mt-3 flex items-start gap-2 text-xs text-muted">
                    <LockIcon className="mt-0.5 h-4 w-4 shrink-0" />
                    Digitally signed by both parties. Any change to this agreement would invalidate the signatures.
                  </p>
                  <Button variant="ghost" size="sm" className="mt-4 w-full border border-line" onClick={() => window.print()}>
                    Download Contract (PDF)
                  </Button>
                </>
              ) : agreement === null ? (
                <p className="text-sm text-muted">No agreement on file.</p>
              ) : (
                <Loading />
              )}</div>
          </details>
        </Card>

        {!settled && (
          <div className="mt-6 flex flex-col gap-2">
            {deal.status === "Accepted" && iAmBuyer && (
              <ButtonLink size="lg" href={`${base}/pay`}>
                Pay {fmtInr(deal.amount)}
              </ButtonLink>
            )}
            {deal.status === "Accepted" && !iAmBuyer && (
              <p className="rounded-2xl bg-surface-2 px-4 py-3 text-center text-sm text-muted">
                Waiting for {(other || "").split(" ")[0]} to pay. You&apos;ll be able to deliver once the money is held.
              </p>
            )}
            {deal.status === "Funded" && !iAmBuyer && (
              <Card>
                <p className="text-[15px] font-semibold">Finished the work?</p>
                <p className="mt-1 text-sm text-muted">
                  Mark it delivered. {(other || "").split(" ")[0]} then has {Math.round(deal.reviewPeriod / 86400)} days to review
                  before the money is released to you.
                </p>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className={inputCls + " mt-3"}
                  placeholder="Optional note, e.g. where to find the files"
                />
                <Button size="lg" className="mt-3 w-full" onClick={deliver} disabled={busy}>
                  {busy ? "Saving…" : "Mark as delivered"}
                </Button>
              </Card>
            )}
            {deal.status === "Delivered" && !iAmBuyer && (
              <p className="rounded-2xl bg-accent-soft px-4 py-3 text-center text-sm text-accent">
                Delivered. Waiting for {(other || "").split(" ")[0]} to review and release the payment.
              </p>
            )}
            {deal.status === "Delivered" && iAmBuyer && deal.deliveryNote && (
              <Card>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Delivery note from {(other || "").split(" ")[0]}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{deal.deliveryNote}</p>
              </Card>
            )}
            {CAN_COMPLAIN.includes(deal.status) && iAmBuyer && (
              <Button size="lg" onClick={() => setAskPin(true)} disabled={busy}>
                Work is done — release payment
              </Button>
            )}
            {CAN_COMPLAIN.includes(deal.status) && (
              <ButtonLink size="lg" variant="danger" href={`${base}/complaint`}>
                Raise a complaint
              </ButtonLink>
            )}
            {COMPLAINT_OPEN.includes(deal.status) && (
              <ButtonLink size="lg" variant="secondary" href={`${base}/resolution`}>
                View complaint status
              </ButtonLink>
            )}
          </div>
        )}
      </Screen>
      {askPin && (
        <PinSheet
          title={`Release ${fmtInr(deal.amount)}`}
          subtitle={`${other} receives the money now. This can't be undone.`}
          onSubmit={release}
          onClose={() => setAskPin(false)}
        />
      )}
    </>
  );
}
