// The agreed scope of work, in plain words: what gets delivered and how much of the payment each part is worth.
import { fmtBps, fmtDate } from "@/lib/format";
import type { Sow } from "@/lib/types";

export function SowList({ sow }: { sow: Sow }) {
  return (
    <div>
      <ol className="space-y-4">
        {sow.deliverables.map((d, i) => (
          <li key={d.id} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{d.title}</p>
                <span className="shrink-0 text-xs text-muted">{fmtBps(d.weightBps)} of payment</span>
              </div>
              <p className="text-sm text-muted">{d.description}</p>
              <ul className="mt-1 space-y-0.5 text-sm">
                {d.acceptanceCriteria.map((c) => (
                  <li key={c} className="flex gap-1.5">
                    <span className="text-success">✓</span>
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
        Deliver by {sow.deliveryDeadline ? fmtDate(sow.deliveryDeadline) : "— to be agreed"} ·{" "}
        {Math.round(sow.reviewWindowSecs / 86400)} days to review after delivery
      </p>
    </div>
  );
}
