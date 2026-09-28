"use client";
// Transaction details, shown only when a row is tapped (GPay style).
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CAN_COMPLAIN, COMPLAINT_OPEN, fmtDateTime, fmtInr, initiatedAt, isSettled, releasedAt, txnId } from "@/lib/format";
import type { Sow } from "@/lib/types";
import { useUser } from "@/components/session";
import { useDeal } from "@/components/useDeal";
import { SowList } from "@/components/SowList";
import { Avatar, BackBar, Button, ButtonLink, Card, Loading, Row, Screen, StatusChip } from "@/components/ui";

export default function TxnPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const { deal, error, reload } = useDeal(id);
  const [sow, setSow] = useState<Sow>();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.getDealSow(id).then(setSow);
  }, [id]);

  if (!deal) return (<><BackBar href="/home" />{error ? <p className="p-6 text-center text-danger">{error}</p> : <Loading />}</>);

  const iAmBuyer = deal.buyer.toLowerCase() === user.address.toLowerCase();
  const other = iAmBuyer ? deal.sellerName : deal.buyerName;
  const settled = isSettled(deal);
  const released = releasedAt(deal);
  const base = `/txn/${deal.id}`;
  const heading = settled ? (iAmBuyer ? `Paid to ${other}` : `Received from ${other}`) : iAmBuyer ? `Paying ${other}` : `From ${other}`;
  const toBuyer = deal.buyerBps ? (BigInt(deal.amount) * BigInt(deal.buyerBps)) / 10000n : 0n;
  const splitSettled = settled && deal.status !== "Released" && deal.buyerBps !== undefined;

  async function release() {
    if (!confirm(`Release ${fmtInr(deal!.amount)} to ${other}? This can't be undone.`)) return;
    setBusy(true);
    await api.release(deal!.id);
    await reload();
    setBusy(false);
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
      <Screen className="pt-8">
        <div className="flex flex-col items-center text-center">
          <Avatar name={other} size="lg" />
          <p className="mt-3 text-sm text-muted">{heading}</p>
          <p className="mt-1 text-4xl font-semibold sm:text-5xl">{fmtInr(deal.amount)}</p>
          <p className="mt-1 text-sm text-muted">{deal.title}</p>
          <div className="mt-3">
            <StatusChip status={deal.status} />
          </div>
        </div>

        {splitSettled && (
          <Card className="mt-6">
            <p className="text-sm font-medium">Settled after a complaint</p>
            <dl className="mt-1 divide-y divide-line">
              <Row label={iAmBuyer ? "Refunded to you" : `Refunded to ${other}`}>{fmtInr(toBuyer)}</Row>
              <Row label={iAmBuyer ? `Paid to ${other}` : "Paid to you"}>{fmtInr(BigInt(deal.amount) - toBuyer)}</Row>
            </dl>
            <ButtonLink variant="ghost" size="sm" className="mt-1 -ml-3" href={`${base}/resolution`}>
              View complaint details ›
            </ButtonLink>
          </Card>
        )}

        <Card className="mt-6">
          <dl className="divide-y divide-line">
            <Row label="Transaction ID">
              <button onClick={copyId} className="font-mono hover:text-accent" title="Copy">
                {txnId(deal.id)} <span className="text-xs text-muted">{copied ? "Copied" : "⧉"}</span>
              </button>
            </Row>
            <Row label="Initiated on">{fmtDateTime(initiatedAt(deal))}</Row>
            <Row label="Released on">
              {released ? fmtDateTime(released) : <span className="font-normal text-muted">Not released yet</span>}
            </Row>
          </dl>
        </Card>

        <Card className="mt-4" flush>
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between p-4 sm:p-5">
              <span className="font-medium">Agreement (scope of work)</span>
              <span className="text-muted transition group-open:rotate-90">›</span>
            </summary>
            <div className="border-t border-line p-4 sm:p-5">{sow ? <SowList sow={sow} /> : <Loading />}</div>
          </details>
        </Card>

        {!settled && (
          <div className="mt-6 flex flex-col gap-2">
            {deal.status === "Accepted" && iAmBuyer && (
              <ButtonLink size="lg" href={`${base}/pay`}>
                Pay {fmtInr(deal.amount)}
              </ButtonLink>
            )}
            {CAN_COMPLAIN.includes(deal.status) && iAmBuyer && (
              <Button size="lg" onClick={release} disabled={busy}>
                {busy ? "Releasing…" : "Work is done — release payment"}
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
    </>
  );
}
