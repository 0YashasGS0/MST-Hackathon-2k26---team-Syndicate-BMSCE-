"use client";
// One escalated case: both parties, the signed agreement, the complaint and proof, the AI's suggestion,
// and the arbitrator's final ruling (refund % to the payer + reasons).
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { verifySignature } from "@/lib/agreement";
import { fmtBps, fmtDateTime, fmtInr } from "@/lib/format";
import type { Complaint, Resolution, SowVersion } from "@/lib/types";
import { useDeal } from "@/components/useDeal";
import { SowList } from "@/components/SowList";
import { CheckIcon, GavelIcon, LockIcon } from "@/components/icons";
import { Avatar, BackBar, Badge, Button, Card, cx, inputCls, Loading, Screen, SectionTitle } from "@/components/ui";

export default function CasePage() {
  const { id } = useParams<{ id: string }>();
  const { deal, setDeal } = useDeal(id);
  const [agreement, setAgreement] = useState<SowVersion | null>();
  const [sigsOk, setSigsOk] = useState<boolean>();
  const [complaint, setComplaint] = useState<Complaint | null>();
  const [ai, setAi] = useState<Resolution>();
  const [refundPct, setRefundPct] = useState<number>();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.getComplaint(id).then(setComplaint);
    api.getResolution(id).then((r) => {
      setAi(r);
      setRefundPct((p) => p ?? r.buyerBps / 100);
    });
    api.getAgreement(id).then(async (a) => {
      setAgreement(a);
      if (a) setSigsOk((await Promise.all(a.signatures.map((s) => verifySignature(a.sow, s)))).every(Boolean) && a.signatures.length === 2);
    });
  }, [id]);

  if (!deal || complaint === undefined || refundPct === undefined)
    return (
      <>
        <BackBar href="/arbitrator" title="Case" />
        <Loading />
      </>
    );

  const open = deal.status === "Escalated";
  const amount = BigInt(deal.amount);
  const bps = Math.round(refundPct * 100);
  const toBuyer = (amount * BigInt(bps)) / 10000n;
  const raisedBy = complaint?.raisedBy === "seller" ? deal.sellerName : deal.buyerName;

  async function rule() {
    if (!confirm(`Final ruling: refund ${fmtBps(bps)} (${fmtInr(toBuyer)}) to ${deal!.buyerName} and pay ${fmtInr(amount - toBuyer)} to ${deal!.sellerName}? This can't be changed.`))
      return;
    setBusy(true);
    setError(undefined);
    try {
      setDeal(await api.arbitrate(id, bps, note.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <BackBar href="/arbitrator" title={`Case ${deal.id}`} right={open ? <Badge tone="danger">Open</Badge> : <Badge tone="success">Ruled</Badge>} />
      <Screen className="pt-6">
        <Card>
          <p className="text-lg font-semibold tracking-tight">{deal.title}</p>
          <p className="num mt-1 text-3xl font-semibold">{fmtInr(deal.amount)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Party name={deal.buyerName} role="Payer" />
            <Party name={deal.sellerName} role="Payee" />
          </div>
        </Card>

        <SectionTitle>Complaint</SectionTitle>
        {complaint ? (
          <Card>
            <p className="text-xs text-muted">
              Raised by {raisedBy} · {fmtDateTime(complaint.createdAt)}
            </p>
            {complaint.deliverableIds.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {complaint.deliverableIds.map((d) => (
                  <Badge key={d} tone="danger">
                    {agreement?.sow.deliverables.find((x) => x.id === d)?.title ?? d}
                  </Badge>
                ))}
              </div>
            )}
            <p className="mt-3 whitespace-pre-wrap text-sm">{complaint.text}</p>
            {complaint.attachments.length > 0 && (
              <ul className="mt-4 grid grid-cols-2 gap-2">
                {complaint.attachments.map((a) => (
                  <li key={a.name} className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 text-xs">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface">{a.type.startsWith("video/") ? "▶" : "🖼"}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="text-muted">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">File previews arrive once evidence storage is connected.</p>
          </Card>
        ) : (
          <Card>
            <p className="text-sm text-muted">No complaint text on file.</p>
          </Card>
        )}

        {deal.deliveryNote && (
          <>
            <SectionTitle>Delivery note from {deal.sellerName}</SectionTitle>
            <Card>
              <p className="whitespace-pre-wrap text-sm">{deal.deliveryNote}</p>
            </Card>
          </>
        )}

        <SectionTitle
          right={
            sigsOk !== undefined && (
              <span className={cx("flex items-center gap-1 text-xs font-semibold", sigsOk ? "text-success" : "text-danger")}>
                {sigsOk ? <CheckIcon className="h-4 w-4" /> : null}
                {sigsOk ? "Both signatures verified" : "Signature problem"}
              </span>
            )
          }
        >
          Signed agreement
        </SectionTitle>
        <Card>{agreement ? <SowList sow={agreement.sow} /> : <p className="text-sm text-muted">No agreement on file.</p>}</Card>

        {ai && (
          <>
            <SectionTitle>AI suggestion (rejected by a party)</SectionTitle>
            <Card className="space-y-4">
              <p className="text-sm">
                Refund <b>{fmtBps(ai.buyerBps)}</b> to the payer
              </p>
              {ai.scores.map((s) => (
                <div key={s.id}>
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{agreement?.sow.deliverables.find((x) => x.id === s.id)?.title ?? s.id}</span>
                    <span>{s.fulfilledPct}% done</span>
                  </div>
                  <p className="text-xs text-muted">{s.rationale}</p>
                </div>
              ))}
            </Card>
          </>
        )}

        <SectionTitle>{open ? "Your ruling" : "Ruling"}</SectionTitle>
        <Card>
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-medium">Refund to {(deal.buyerName || "").split(" ")[0]}</p>
            <p className="num text-2xl font-semibold">{open ? refundPct : (deal.buyerBps ?? 0) / 100}%</p>
          </div>
          {open && (
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={refundPct}
              onChange={(e) => setRefundPct(Number(e.target.value))}
              className="mt-3 w-full accent-[var(--accent)]"
              aria-label="Refund percentage"
            />
          )}
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-info/10 p-3">
              <p className="text-xs text-muted">To {(deal.buyerName || "").split(" ")[0]}</p>
              <p className="num font-semibold text-info">{fmtInr(open ? toBuyer : (amount * BigInt(deal.buyerBps ?? 0)) / 10000n)}</p>
            </div>
            <div className="rounded-2xl bg-accent-soft p-3">
              <p className="text-xs text-muted">To {(deal.sellerName || "").split(" ")[0]}</p>
              <p className="num font-semibold text-accent">
                {fmtInr(open ? amount - toBuyer : amount - (amount * BigInt(deal.buyerBps ?? 0)) / 10000n)}
              </p>
            </div>
          </div>
          {open ? (
            <>
              <textarea
                rows={4}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className={inputCls + " mt-4"}
                placeholder="Reasons for the ruling. Both parties will see this."
              />
              <Button size="lg" className="mt-4 w-full" disabled={busy || note.trim().length < 10} onClick={rule}>
                <GavelIcon className="h-5 w-5" />
                {busy ? "Recording ruling…" : "Issue final ruling"}
              </Button>
              <p className="mt-3 flex items-start gap-2 text-xs text-muted">
                <LockIcon className="mt-0.5 h-4 w-4 shrink-0" />
                The ruling moves the money immediately and is recorded permanently.
              </p>
            </>
          ) : (
            deal.arbitratorNote && <p className="mt-4 whitespace-pre-wrap text-sm text-muted">{deal.arbitratorNote}</p>
          )}
          {error && <p className="mt-3 text-sm text-danger">{error}</p>}
        </Card>
      </Screen>
    </>
  );
}

function Party({ name, role }: { name: string; role: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl bg-surface-2 p-3">
      <Avatar name={name} size="sm" />
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{name}</p>
        <p className="text-xs text-muted">{role}</p>
      </div>
    </div>
  );
}
