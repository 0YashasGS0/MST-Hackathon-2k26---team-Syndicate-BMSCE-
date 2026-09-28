"use client";
// One scrolling screen, GPay / PhonePe style: pay first, then what's in progress, then history.
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { CAN_COMPLAIN, COMPLAINT_OPEN, fmtDate, fmtInr, fmtMonth, initiatedAt, isSettled, releasedAt } from "@/lib/format";
import type { Deal, Draft } from "@/lib/types";
import { useUser } from "@/components/session";
import { Header } from "@/components/Header";
import { Avatar, ButtonLink, Card, EmptyState, Loading, Screen, SectionTitle, StatusChip } from "@/components/ui";

export default function Home() {
  const user = useUser();
  const [deals, setDeals] = useState<Deal[]>();
  const [drafts, setDrafts] = useState<Draft[]>([]);

  useEffect(() => {
    api.listDeals(user.address).then(setDeals);
    api.listDrafts(user.address).then(setDrafts);
  }, [user.address]);

  const me = user.address.toLowerCase();
  const inProgress = deals?.filter((d) => !isSettled(d)) ?? [];
  const history = (deals?.filter(isSettled) ?? []).sort((a, b) => (releasedAt(b) ?? 0) - (releasedAt(a) ?? 0));
  const firstName = user.name?.split(" ")[0];

  return (
    <>
      <Header />
      <Screen className="pt-6">
        <p className="px-1 text-muted">{firstName ? `Hi ${firstName} 👋` : "Welcome 👋"}</p>

        {/* 1. initiate payment */}
        <Link
          href="/pay/new"
          className="mt-3 flex items-center gap-4 rounded-2xl bg-accent p-5 text-accent-fg shadow-sm transition hover:opacity-95 active:scale-[0.99] sm:p-6"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/20">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </span>
          <span className="flex-1">
            <span className="block text-lg font-semibold">Initiate payment</span>
            <span className="block text-sm opacity-90">Money is held safely until the work is done</span>
          </span>
          <span className="text-2xl">›</span>
        </Link>

        {/* 2. in progress */}
        <SectionTitle>In progress</SectionTitle>
        {!deals ? (
          <Loading />
        ) : inProgress.length + drafts.length === 0 ? (
          <EmptyState title="Nothing in progress">Payments you start will show up here.</EmptyState>
        ) : (
          <div className="space-y-3">
            {drafts.map((d) => {
              const other = d.buyer.toLowerCase() === me ? d.sellerName : d.buyerName;
              return (
                <Card key={d.id} flush>
                  <Link href={`/pay/agreement/${d.id}`} className="flex items-center gap-3 p-4">
                    <Avatar name={other} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{other}</p>
                      <p className="truncate text-sm text-muted">{d.purpose}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{fmtInr(d.price)}</p>
                      <p className="text-xs text-warning">Agree terms</p>
                    </div>
                  </Link>
                </Card>
              );
            })}
            {inProgress.map((d) => (
              <InProgressRow key={d.id} deal={d} iAmBuyer={d.buyer.toLowerCase() === me} />
            ))}
          </div>
        )}

        {/* 3. history */}
        <SectionTitle>Payment history</SectionTitle>
        {!deals ? null : history.length === 0 ? (
          <EmptyState title="No payments yet" />
        ) : (
          <History deals={history} me={me} />
        )}
      </Screen>
    </>
  );
}

function InProgressRow({ deal, iAmBuyer }: { deal: Deal; iAmBuyer: boolean }) {
  const other = iAmBuyer ? deal.sellerName : deal.buyerName;
  const base = `/txn/${deal.id}`;
  const complaintOpen = COMPLAINT_OPEN.includes(deal.status);

  return (
    <Card flush>
      <Link href={base} className="flex items-center gap-3 p-4 pb-3">
        <Avatar name={other} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{other}</p>
          <p className="truncate text-sm text-muted">{deal.title}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold">{fmtInr(deal.amount)}</p>
          <p className="text-xs text-muted">{fmtDate(initiatedAt(deal))}</p>
        </div>
      </Link>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
        <StatusChip status={deal.status} />
        <div className="ml-auto flex gap-2">
          {deal.status === "Accepted" && iAmBuyer && (
            <ButtonLink size="sm" href={`${base}/pay`}>
              Pay now
            </ButtonLink>
          )}
          {CAN_COMPLAIN.includes(deal.status) && (
            <ButtonLink size="sm" variant="danger" href={`${base}/complaint`}>
              Raise a complaint
            </ButtonLink>
          )}
          {complaintOpen && (
            <ButtonLink size="sm" variant="secondary" href={`${base}/resolution`}>
              {deal.status === "ResolutionProposed" ? "See resolution" : "Complaint status"}
            </ButtonLink>
          )}
        </div>
      </div>
    </Card>
  );
}

function History({ deals, me }: { deals: Deal[]; me: string }) {
  const groups = new Map<string, Deal[]>();
  for (const d of deals) {
    const k = fmtMonth(releasedAt(d) ?? initiatedAt(d));
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return (
    <div className="space-y-5">
      {[...groups].map(([month, list]) => (
        <div key={month}>
          <p className="mb-2 px-1 text-xs font-medium text-muted">{month}</p>
          <Card className="divide-y divide-line" flush>
            {list.map((d) => {
              const received = d.seller.toLowerCase() === me;
              const other = received ? d.buyerName : d.sellerName;
              return (
                <Link key={d.id} href={`/txn/${d.id}`} className="flex items-center gap-3 p-4 hover:bg-surface-2">
                  <Avatar name={other} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{other}</p>
                    <p className="truncate text-xs text-muted">
                      {received ? "Received" : "Paid"} · {fmtDate(releasedAt(d) ?? initiatedAt(d))}
                    </p>
                  </div>
                  <p className={`shrink-0 font-semibold ${received ? "text-success" : ""}`}>
                    {received ? "+" : ""}
                    {fmtInr(d.amount)}
                  </p>
                </Link>
              );
            })}
          </Card>
        </div>
      ))}
    </div>
  );
}
