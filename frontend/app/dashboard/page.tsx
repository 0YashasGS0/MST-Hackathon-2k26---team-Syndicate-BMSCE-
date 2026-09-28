"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { useSession } from "@/components/session";
import { api } from "@/lib/api";
import { fmtUsd } from "@/lib/format";
import type { Deal, Draft } from "@/lib/types";
import { Badge, ButtonLink, Card, EmptyState, PageHeader, Stat, StatusChip } from "@/components/ui";

const DEMO = "0x1111111111111111111111111111111111111111" as Address;
type Tab = "buyer" | "seller" | "drafts";

export default function Dashboard() {
  const { address } = useSession();
  const me = address ?? DEMO;
  const [tab, setTab] = useState<Tab>("buyer");
  const [deals, setDeals] = useState<Deal[]>();
  const [drafts, setDrafts] = useState<Draft[]>();

  useEffect(() => {
    api.listDeals(me).then(setDeals);
    api.listDrafts(me).then(setDrafts);
  }, [me]);

  const lower = me.toLowerCase();
  const asBuyer = deals?.filter((d) => d.buyer.toLowerCase() === lower) ?? [];
  const asSeller = deals?.filter((d) => d.seller.toLowerCase() === lower) ?? [];
  const locked = (deals ?? [])
    .filter((d) => ["Funded", "Delivered", "Disputed", "ResolutionProposed", "Escalated"].includes(d.status))
    .reduce((s, d) => s + BigInt(d.amount), 0n);
  const needsAction = (deals ?? []).filter((d) => ["Delivered", "ResolutionProposed"].includes(d.status)).length;

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "buyer", label: "As buyer", count: asBuyer.length },
    { key: "seller", label: "As seller", count: asSeller.length },
    { key: "drafts", label: "In negotiation", count: drafts?.length ?? 0 },
  ];

  return (
    <div>
      <PageHeader title="My deals" actions={<ButtonLink href="/deals/new">New deal</ButtonLink>} />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <Stat label="Locked in escrow" value={`${fmtUsd(locked)} mUSD`} sub="Held by the contract" />
        </Card>
        <Card>
          <Stat label="Active deals" value={deals?.length ?? "–"} />
        </Card>
        <Card>
          <Stat label="Need your action" value={needsAction} sub="Review a delivery or resolution" />
        </Card>
      </div>

      <div className="mb-4 flex gap-1 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${tab === t.key ? "border-accent font-medium" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {t.label} <span className="ml-1 text-xs text-muted">{t.count}</span>
          </button>
        ))}
      </div>

      {tab === "drafts" ? (
        <DraftList drafts={drafts} />
      ) : (
        <DealList deals={deals ? (tab === "buyer" ? asBuyer : asSeller) : undefined} />
      )}
    </div>
  );
}

function DealList({ deals }: { deals?: Deal[] }) {
  if (!deals) return <p className="text-sm text-muted">Loading…</p>;
  if (!deals.length) return <EmptyState title="No deals yet">Create one to get started.</EmptyState>;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {deals.map((d) => (
        <Link key={d.id} href={`/deals/${d.id}`} className="flex items-center gap-4 border-b border-line p-4 last:border-0 hover:bg-surface-2">
          <span className="w-10 font-mono text-xs text-muted">#{d.id}</span>
          <span className="flex-1 font-medium">{d.title}</span>
          <span className="text-sm">{fmtUsd(d.amount)} mUSD</span>
          <StatusChip status={d.status} />
        </Link>
      ))}
    </div>
  );
}

function DraftList({ drafts }: { drafts?: Draft[] }) {
  if (!drafts) return <p className="text-sm text-muted">Loading…</p>;
  if (!drafts.length) return <EmptyState title="Nothing in negotiation" />;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      {drafts.map((d) => (
        <Link key={d.id} href={`/drafts/${d.id}`} className="flex items-center gap-4 border-b border-line p-4 last:border-0 hover:bg-surface-2">
          <span className="flex-1 font-medium">{d.purpose}</span>
          <span className="text-sm">{fmtUsd(d.price)} mUSD</span>
          <Badge tone="info">{d.status.replaceAll("_", " ")}</Badge>
        </Link>
      ))}
    </div>
  );
}
