"use client";
// Arbitrator console: complaints the parties escalated after rejecting the AI's suggestion.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtDate, fmtInr, releasedAt } from "@/lib/format";
import type { Deal } from "@/lib/types";
import { useSession } from "@/components/session";
import { Logo } from "@/components/Header";
import { GavelIcon } from "@/components/icons";
import { Avatar, Badge, Card, EmptyState, ListRow, Loading, Screen, SectionTitle } from "@/components/ui";

export default function ArbitratorHome() {
  const { signOut } = useSession();
  const [cases, setCases] = useState<Deal[]>();

  useEffect(() => {
    const load = () => api.listCases().then(setCases);
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  const open = cases?.filter((c) => c.status === "Escalated") ?? [];
  const ruled = cases?.filter((c) => c.status !== "Escalated") ?? [];

  return (
    <>
      <div className="hero-gradient pb-20 text-white">
        <header className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
          <Logo onDark />
          <button onClick={() => signOut()} className="text-sm text-white/75 hover:text-white">
            Log out
          </button>
        </header>
        <div className="mx-auto max-w-2xl px-5 pt-4 sm:px-7">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold">
            <GavelIcon className="h-3.5 w-3.5" /> Arbitrator
          </span>
          <p className="num mt-3 text-4xl font-semibold">{cases ? open.length : "—"}</p>
          <p className="text-sm text-white/80">unresolved case{open.length === 1 ? "" : "s"} waiting for your ruling</p>
        </div>
      </div>

      <Screen className="-mt-12">
        {!cases ? (
          <Loading />
        ) : (
          <>
            {open.length === 0 ? (
              <EmptyState title="No open cases" icon={<GavelIcon className="h-6 w-6" />}>
                Escalated complaints will appear here.
              </EmptyState>
            ) : (
              <Card flush className="divide-y divide-line/70">
                {open.map((c) => (
                  <CaseRow key={c.id} deal={c} />
                ))}
              </Card>
            )}

            {ruled.length > 0 && (
              <>
                <SectionTitle>Ruled</SectionTitle>
                <Card flush className="divide-y divide-line/70">
                  {ruled.map((c) => (
                    <CaseRow key={c.id} deal={c} />
                  ))}
                </Card>
              </>
            )}
          </>
        )}
      </Screen>
    </>
  );
}

function CaseRow({ deal }: { deal: Deal }) {
  const escalatedAt = [...deal.events].reverse().find((e) => e.name === "Escalated")?.timestamp;
  const done = deal.status !== "Escalated";
  return (
    <ListRow
      href={`/arbitrator/${deal.id}`}
      leading={<Avatar name={deal.buyerName} />}
      title={deal.title}
      subtitle={`${deal.buyerName} vs ${deal.sellerName} · ${done ? `ruled ${fmtDate(releasedAt(deal) ?? 0)}` : `escalated ${fmtDate(escalatedAt ?? 0)}`}`}
      trailing={
        <div className="flex flex-col items-end gap-1">
          <p className="num text-[15px] font-semibold">{fmtInr(deal.amount)}</p>
          {done ? <Badge tone="success">Ruled</Badge> : <Badge tone="danger">Open</Badge>}
        </div>
      }
    />
  );
}
