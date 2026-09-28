import { notFound } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { fmtBps, fmtUsd } from "@/lib/format";
import { Card, Hash, PageHeader, StatusChip } from "@/components/ui";
import { ResolutionActions } from "@/components/ResolutionActions";

// Deliverable weights come from the SOW; mock mirrors lib/mocks demoSow.
const weights: Record<string, { title: string; weightBps: number }> = {
  D1: { title: "Responsive landing page", weightBps: 5000 },
  D2: { title: "Online order form", weightBps: 3000 },
  D3: { title: "Deployment", weightBps: 2000 },
};

export default async function ResolutionPage(props: PageProps<"/deals/[id]/resolution">) {
  const { id } = await props.params;
  const [deal, res] = await Promise.all([api.getDeal(id).catch(() => notFound()), api.getResolution(id)]);
  const amount = BigInt(deal.amount);
  const toBuyer = (amount * BigInt(res.buyerBps)) / 10000n;
  const toSeller = amount - toBuyer;

  return (
    <div>
      <PageHeader
        title="Proposed resolution"
        subtitle={
          <span className="inline-flex items-center gap-2">
            <Link href={`/deals/${id}`} className="hover:underline">
              Deal #{id}
            </Link>
            <StatusChip status={deal.status} />
          </span>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="How the AI scored each deliverable" className="lg:col-span-2">
          <div className="space-y-5">
            {res.scores.map((s) => {
              const w = weights[s.id];
              return (
                <div key={s.id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">
                      <span className="mr-2 font-mono text-xs text-muted">{s.id}</span>
                      {w?.title ?? s.id}
                    </p>
                    <p className="text-sm text-muted">weight {w ? fmtBps(w.weightBps) : "?"}</p>
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 flex-1 rounded bg-surface-2">
                      <div
                        className={`h-full rounded ${s.fulfilledPct >= 80 ? "bg-success" : s.fulfilledPct >= 40 ? "bg-warning" : "bg-danger"}`}
                        style={{ width: `${s.fulfilledPct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-sm font-medium">{s.fulfilledPct}%</span>
                  </div>
                  <p className="mt-1.5 text-sm text-muted">
                    {s.rationale} <span className="font-mono text-xs">[{s.evidenceRefs.join(", ")}]</span>
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-6 rounded-lg bg-surface-2 p-3 text-xs text-muted">
            The AI only outputs scores. The split is computed by a fixed formula:{" "}
            <code>buyerBps = Σ floor(weightBps × (100 − fulfilled) / 100)</code>
          </p>
        </Card>

        <div className="space-y-4">
          <Card title="Resulting split">
            <SplitBar buyerBps={res.buyerBps} />
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Refund to buyer</dt>
                <dd className="font-medium">
                  {fmtUsd(toBuyer)} mUSD · {fmtBps(res.buyerBps)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Paid to seller</dt>
                <dd className="font-medium">
                  {fmtUsd(toSeller)} mUSD · {fmtBps(10000 - res.buyerBps)}
                </dd>
              </div>
              <div className="flex justify-between pt-2">
                <dt className="text-muted">Reasoning hash</dt>
                <dd>
                  <Hash value={res.reasoningHash} />
                </dd>
              </div>
            </dl>
          </Card>
          <ResolutionActions dealId={id} />
        </div>
      </div>
    </div>
  );
}

function SplitBar({ buyerBps }: { buyerBps: number }) {
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded">
        <div className="bg-info" style={{ width: `${buyerBps / 100}%` }} />
        <div className="bg-accent" style={{ width: `${100 - buyerBps / 100}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>Buyer</span>
        <span>Seller</span>
      </div>
    </div>
  );
}
