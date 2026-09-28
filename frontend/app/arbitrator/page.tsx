"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { api } from "@/lib/api";
import { fmtBps, fmtUsd } from "@/lib/format";
import type { Deal, Resolution } from "@/lib/types";
import { Button, Card, EmptyState, Field, Hash, inputCls, MockNote, PageHeader, StatusChip, TxLink } from "@/components/ui";

const DEMO = "0x1111111111111111111111111111111111111111" as Address;

export default function ArbitratorConsole() {
  const [deals, setDeals] = useState<Deal[]>();
  const [selected, setSelected] = useState<Deal>();

  useEffect(() => {
    // TODO(FE): replace with an admin "list escalated deals" endpoint.
    api.listDeals(DEMO).then((all) => {
      const esc = all.filter((d) => d.status === "Escalated");
      setDeals(esc);
      setSelected(esc[0]);
    });
  }, []);

  return (
    <div>
      <PageHeader title="Arbitrator console" subtitle="Escalated deals. Your ruling is final and is written on MST." />
      {!deals ? (
        <p className="text-muted">Loading…</p>
      ) : !deals.length ? (
        <EmptyState title="No escalated deals" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Queue">
            <ul className="space-y-1">
              {deals.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => setSelected(d)}
                    className={`w-full rounded-lg p-3 text-left text-sm ${selected?.id === d.id ? "bg-surface-2" : "hover:bg-surface-2"}`}
                  >
                    <div className="font-medium">
                      #{d.id} {d.title}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                      {fmtUsd(d.amount)} mUSD <StatusChip status={d.status} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
          {selected && <RulingPanel key={selected.id} deal={selected} />}
        </div>
      )}
    </div>
  );
}

function RulingPanel({ deal }: { deal: Deal }) {
  const [res, setRes] = useState<Resolution>();
  const [bps, setBps] = useState(deal.buyerBps ?? 5000);
  const [token, setToken] = useState("");
  const [tx, setTx] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.getResolution(deal.id).then(setRes);
  }, [deal.id]);

  const amount = BigInt(deal.amount);
  const toBuyer = (amount * BigInt(bps)) / 10000n;

  async function rule() {
    setBusy(true);
    const r = await api.arbitrate(deal.id, bps, token);
    setTx(r.txHash);
    setBusy(false);
  }

  return (
    <div className="space-y-4 lg:col-span-2">
      <Card
        title={`#${deal.id} ${deal.title}`}
        actions={
          <Link href={`/deals/${deal.id}`} className="text-sm text-accent hover:underline">
            Open deal →
          </Link>
        }
      >
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <p>
            SOW hash <Hash value={deal.sowHash} />
          </p>
          {deal.evidenceHash && (
            <p>
              Evidence <Hash value={deal.evidenceHash} />
            </p>
          )}
        </div>
        <h3 className="mt-5 text-sm font-semibold">Agent&apos;s reasoning</h3>
        {!res ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {res.scores.map((s) => (
              <li key={s.id} className="rounded-lg bg-surface-2 p-3">
                <b className="font-mono text-xs">{s.id}</b> · {s.fulfilledPct}% fulfilled — {s.rationale}
              </li>
            ))}
            <li className="text-muted">Agent proposed: buyer refund {fmtBps(res.buyerBps)}</li>
          </ul>
        )}
      </Card>

      <Card title="Your ruling">
        <input
          type="range"
          min={0}
          max={10000}
          step={100}
          value={bps}
          onChange={(e) => setBps(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
        <div className="mt-2 flex justify-between text-sm">
          <span>
            Buyer <b>{fmtUsd(toBuyer)} mUSD</b> ({fmtBps(bps)})
          </span>
          <span>
            Seller <b>{fmtUsd(amount - toBuyer)} mUSD</b> ({fmtBps(10000 - bps)})
          </span>
        </div>
        <div className="mt-4">
          <Field label="Admin token">
            <input type="password" className={inputCls} value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={rule} disabled={busy || !!tx}>
            {busy ? "Submitting…" : "Rule"}
          </Button>
          {tx && <TxLink hash={tx} label="Ruling transaction" />}
        </div>
        <MockNote>ruling goes to the mock; real call is POST /arbitrator/deals/:id/rule → arbitrate().</MockNote>
      </Card>
    </div>
  );
}
