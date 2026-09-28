"use client";
// Complaint status + the suggested resolution, in plain words.
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtDateTime, fmtInr, releasedAt } from "@/lib/format";
import type { Complaint, Deal, Resolution, Sow } from "@/lib/types";
import { useUser } from "@/components/session";
import { useDeal } from "@/components/useDeal";
import { Avatar, BackBar, Button, Card, cx, Loading, Screen, SectionTitle } from "@/components/ui";

export default function ResolutionPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  const { deal, reload, setDeal } = useDeal(id);
  const [complaint, setComplaint] = useState<Complaint | null>();
  const [resolution, setResolution] = useState<Resolution>();
  const [sow, setSow] = useState<Sow>();
  const [busy, setBusy] = useState<"accept" | "escalate">();

  const reviewing = deal?.status === "Disputed";
  const hasProposal = deal && deal.buyerBps !== undefined && !reviewing;

  useEffect(() => {
    api.getComplaint(id).then(setComplaint);
    api.getDealSow(id).then(setSow);
  }, [id]);

  useEffect(() => {
    if (hasProposal) api.getResolution(id).then(setResolution);
  }, [id, hasProposal]);

  // While the complaint is being reviewed, check back every few seconds.
  useEffect(() => {
    if (!reviewing) return;
    const t = setInterval(reload, 2000);
    return () => clearInterval(t);
  }, [reviewing, reload]);

  if (!deal || complaint === undefined) return (<><BackBar href={`/txn/${id}`} title="Complaint" /><Loading /></>);

  const iAmBuyer = deal.buyer.toLowerCase() === user.address.toLowerCase();
  const other = iAmBuyer ? deal.sellerName : deal.buyerName;

  async function act(kind: "accept" | "escalate") {
    const msg =
      kind === "accept"
        ? "Accept this resolution? The money will be split as shown."
        : "Send this to a human arbitrator? Their decision will be final.";
    if (!confirm(msg)) return;
    setBusy(kind);
    setDeal(kind === "accept" ? await api.acceptResolution(id) : await api.escalate(id));
    setBusy(undefined);
  }

  return (
    <>
      <BackBar href={`/txn/${id}`} title="Complaint" />
      <Screen className="pt-6">
        <Card className="flex items-center gap-3">
          <Avatar name={other} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{other}</p>
            <p className="truncate text-sm text-muted">{deal.title}</p>
          </div>
          <p className="font-semibold">{fmtInr(deal.amount)}</p>
        </Card>

        <SectionTitle>Status</SectionTitle>
        <Card>
          <Progress deal={deal} complaint={complaint} />
        </Card>

        {reviewing && (
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-info/10 p-4 text-sm text-info">
            <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-info/30 border-t-info" />
            Reviewing your proof against the agreement. This usually takes a minute.
          </div>
        )}

        {hasProposal && resolution && (
          <>
            <SectionTitle>{deal.status === "ResolutionProposed" ? "Suggested resolution" : "Resolution"}</SectionTitle>
            <Split deal={deal} iAmBuyer={iAmBuyer} other={other} />

            {deal.status === "ResolutionProposed" && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Button size="lg" className="flex-1" onClick={() => act("accept")} disabled={!!busy}>
                  {busy === "accept" ? "Accepting…" : "Accept resolution"}
                </Button>
                <Button size="lg" variant="secondary" className="flex-1" onClick={() => act("escalate")} disabled={!!busy}>
                  {busy === "escalate" ? "Sending…" : "Not fair? Ask an arbitrator"}
                </Button>
              </div>
            )}
            {deal.status === "Escalated" && (
              <p className="mt-4 rounded-2xl bg-warning/10 p-4 text-sm text-warning">
                A human arbitrator is reviewing this complaint. Their decision is final, and the money stays on hold until then.
              </p>
            )}

            <SectionTitle>How each part was judged</SectionTitle>
            <Card className="space-y-5">
              {resolution.scores.map((s) => {
                const d = sow?.deliverables.find((x) => x.id === s.id);
                return (
                  <div key={s.id}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="font-medium">{d?.title ?? s.id}</p>
                      <span className="text-sm font-medium">{s.fulfilledPct}% done</span>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-surface-2">
                      <div
                        className={cx(
                          "h-full rounded-full",
                          s.fulfilledPct >= 80 ? "bg-success" : s.fulfilledPct >= 40 ? "bg-warning" : "bg-danger",
                        )}
                        style={{ width: `${s.fulfilledPct}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-sm text-muted">{s.rationale}</p>
                  </div>
                );
              })}
            </Card>
            <p className="mt-3 px-1 text-xs text-muted">
              The split follows a fixed rule: each part&apos;s share of the payment × how much of it was done. This decision is
              recorded permanently and can&apos;t be changed by anyone — including us.
            </p>
          </>
        )}

        {complaint && <ComplaintCard complaint={complaint} sow={sow} />}
      </Screen>
    </>
  );
}

function Progress({ deal, complaint }: { deal: Deal; complaint: Complaint | null }) {
  const s = deal.status;
  const settledAt = releasedAt(deal);
  const steps = [
    { label: "Complaint raised", sub: complaint ? fmtDateTime(complaint.createdAt) : undefined, done: true },
    { label: "Proof reviewed", done: s !== "Disputed", active: s === "Disputed" },
    ...(s === "Escalated" || (s === "Resolved" && deal.events.some((e) => e.name === "Escalated"))
      ? [{ label: "With arbitrator", done: s !== "Escalated", active: s === "Escalated" }]
      : [{ label: "Resolution suggested", done: s !== "Disputed", active: s === "ResolutionProposed" }]),
    { label: "Money settled", sub: settledAt ? fmtDateTime(settledAt) : undefined, done: !!settledAt },
  ];
  return (
    <ol>
      {steps.map((st, i) => (
        <li key={st.label} className="relative flex gap-3 pb-5 last:pb-0">
          {i < steps.length - 1 && (
            <span className={cx("absolute left-[11px] top-6 h-full w-0.5", st.done ? "bg-success" : "bg-line")} />
          )}
          <span
            className={cx(
              "relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs",
              st.done ? "bg-success text-white" : st.active ? "bg-accent text-accent-fg ring-4 ring-accent/20" : "bg-surface-2 text-muted",
            )}
          >
            {st.done ? "✓" : i + 1}
          </span>
          <div>
            <p className={cx("text-sm font-medium", !st.done && !st.active && "text-muted")}>{st.label}</p>
            {st.sub && <p className="text-xs text-muted">{st.sub}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Split({ deal, iAmBuyer, other }: { deal: Deal; iAmBuyer: boolean; other: string }) {
  const bps = deal.buyerBps ?? 0;
  const toBuyer = (BigInt(deal.amount) * BigInt(bps)) / 10000n;
  const toSeller = BigInt(deal.amount) - toBuyer;
  return (
    <Card>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted">{iAmBuyer ? "Back to you" : `Back to ${other}`}</p>
          <p className="mt-1 text-2xl font-semibold text-info">{fmtInr(toBuyer)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted">{iAmBuyer ? `To ${other}` : "To you"}</p>
          <p className="mt-1 text-2xl font-semibold text-accent">{fmtInr(toSeller)}</p>
        </div>
      </div>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full">
        <div className="bg-info" style={{ width: `${bps / 100}%` }} />
        <div className="bg-accent" style={{ width: `${100 - bps / 100}%` }} />
      </div>
    </Card>
  );
}

function ComplaintCard({ complaint, sow }: { complaint: Complaint; sow?: Sow }) {
  const parts = complaint.deliverableIds.map((d) => sow?.deliverables.find((x) => x.id === d)?.title ?? d);
  return (
    <>
      <SectionTitle>Your complaint</SectionTitle>
      <Card>
        {parts.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {parts.map((p) => (
              <span key={p} className="rounded-full bg-danger/10 px-2.5 py-0.5 text-xs font-medium text-danger">
                {p}
              </span>
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap text-sm">{complaint.text}</p>
        {complaint.attachments.length > 0 && (
          <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {complaint.attachments.map((a) => (
              <li key={a.name} className="flex items-center gap-2 rounded-xl bg-surface-2 p-2 text-xs">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface">
                  {a.type.startsWith("video/") ? "▶" : "🖼"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{a.name}</span>
                  <span className="text-muted">{(a.size / 1024 / 1024).toFixed(1)} MB</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
