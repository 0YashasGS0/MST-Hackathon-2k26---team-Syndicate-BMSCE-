import type { ChainEvent } from "@/lib/types";
import { fmtBps, fmtUsd, shortHex } from "@/lib/format";
import { TxLink } from "./ui";

const labels: Record<string, { title: string; who?: string }> = {
  DealProposed: { title: "Deal proposed", who: "Buyer" },
  DealAccepted: { title: "SOW accepted", who: "Seller" },
  DealFunded: { title: "Escrow funded", who: "ORG (UPI on-ramp)" },
  Delivered: { title: "Delivery submitted", who: "Seller" },
  Released: { title: "Payment released", who: "Buyer" },
  DisputeRaised: { title: "Dispute raised", who: "Buyer" },
  ResolutionProposed: { title: "AI proposed a split", who: "Agent" },
  ResolutionAccepted: { title: "Resolution accepted" },
  Escalated: { title: "Escalated to arbitrator" },
  Arbitrated: { title: "Arbitrator ruled", who: "Arbitrator" },
  Settled: { title: "Settled" },
};

function detail(e: ChainEvent) {
  const a = e.args;
  if (a.amount) return `${fmtUsd(a.amount)} mUSD`;
  if (a.buyerBps) return `Buyer refund ${fmtBps(Number(a.buyerBps))}`;
  if (a.deliveryHash) return `Delivery hash ${shortHex(a.deliveryHash)}`;
  if (a.evidenceHash) return `Evidence hash ${shortHex(a.evidenceHash)}`;
  return null;
}

export function Timeline({ events }: { events: ChainEvent[] }) {
  return (
    <ol className="relative ml-2 border-l border-line">
      {events.map((e, i) => {
        const l = labels[e.name] ?? { title: e.name };
        const last = i === events.length - 1;
        const d = detail(e);
        return (
          <li key={`${e.txHash}-${e.logIndex}`} className="mb-6 ml-6 last:mb-0">
            <span
              className={`absolute -left-[7px] mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-surface ${last ? "bg-accent ring-4 ring-accent/20" : "bg-success"}`}
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="font-medium">{l.title}</p>
              <time className="text-xs text-muted">{new Date(e.timestamp * 1000).toLocaleString()}</time>
            </div>
            <p className="mt-0.5 text-sm text-muted">
              {[l.who, d].filter(Boolean).join(" · ")}
            </p>
            <div className="mt-1 flex items-center gap-3 text-xs text-muted">
              <TxLink hash={e.txHash} label="View on explorer" />
              <span>block {e.block.toLocaleString()}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
