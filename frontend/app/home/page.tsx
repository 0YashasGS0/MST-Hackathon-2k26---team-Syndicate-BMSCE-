"use client";
// Home: quick actions (pay, request, QR, history), people you deal with, and payments still in progress.
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { CAN_COMPLAIN, COMPLAINT_OPEN, fmtDate, fmtInr, initiatedAt, isSettled } from "@/lib/format";
import type { Contact, Deal, Draft } from "@/lib/types";
import { useUser } from "@/components/session";
import { Header } from "@/components/Header";
import { HistoryIcon, PeopleIcon, QrIcon, RequestIcon, SendIcon, ShieldIcon } from "@/components/icons";
import { Avatar, Badge, ButtonLink, Card, EmptyState, ListRow, Loading, Screen, SectionTitle, StatusChip } from "@/components/ui";

const HELD = ["Funded", "Delivered", "Disputed", "ResolutionProposed", "Escalated"];

export default function Home() {
  const user = useUser();
  const [deals, setDeals] = useState<Deal[]>();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [people, setPeople] = useState<Contact[]>();
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.listDeals(user.address).then(setDeals);
    api.listDrafts(user.address).then(setDrafts);
    api.listPeople(user.address).then(setPeople);
  }, [user.address]);

  const me = user.address.toLowerCase();
  const inProgress = deals?.filter((d) => !isSettled(d)) ?? [];
  const held = inProgress.filter((d) => HELD.includes(d.status) && d.buyer.toLowerCase() === me);
  const heldTotal = held.reduce((s, d) => s + BigInt(d.amount), 0n);
  const firstName = user.name?.split(" ")[0];
  const pendingCount = inProgress.length + drafts.length;

  return (
    <>
      <div className="hero-gradient pb-24">
        <Header />
        <div className="mx-auto max-w-2xl px-5 pt-4 text-white sm:px-7">
          <p className="text-sm text-white/75">{firstName ? `Good to see you, ${firstName}` : "Welcome"}</p>
          <div className="mt-5 flex items-center gap-2 text-xs font-medium text-white/75">
            <ShieldIcon className="h-4 w-4" />
            Held safely for you
          </div>
          <p className="num mt-1 text-4xl font-semibold sm:text-5xl">{deals ? fmtInr(heldTotal) : "—"}</p>
          <p className="mt-1 text-sm text-white/75">
            {held.length === 0
              ? "Nothing on hold right now"
              : `Across ${held.length} payment${held.length > 1 ? "s" : ""}, released only when you approve`}
          </p>
        </div>
      </div>

      <Screen className="-mt-16">
        <Card className="grid grid-cols-4 gap-1 p-2 sm:gap-2 sm:p-4">
          <Action href="/pay/new" icon={<SendIcon className="h-6 w-6" />} label="Pay" sub="Send money" />
          <Action href="/pay/new?role=seller" icon={<RequestIcon className="h-6 w-6" />} label="Request" sub="Get paid" />
          <Action href="/qr" icon={<QrIcon className="h-6 w-6" />} label="QR" sub="Scan or show" />
          <Action href="/history" icon={<HistoryIcon className="h-6 w-6" />} label="History" sub="All payments" />
        </Card>

        {people && people.length > 0 && (
          <>
            <SectionTitle>People</SectionTitle>
            <Card className="grid grid-cols-4 gap-y-4 px-2 py-4 sm:px-4">
              {(showAll ? people : people.slice(0, 7)).map((p) => (
                <Link key={p.phone} href={`/people/${p.phone}`} className="group flex flex-col items-center gap-1.5 text-center">
                  <span className="transition group-hover:scale-105 group-active:scale-95">
                    <Avatar name={p.name} size="md" />
                  </span>
                  <span className="w-full truncate px-1 text-xs font-medium">{(p.name || "").split(" ")[0]}</span>
                </Link>
              ))}
              {people.length > 7 && (
                <button onClick={() => setShowAll((v) => !v)} className="group flex flex-col items-center gap-1.5 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-muted transition group-hover:scale-105">
                    <PeopleIcon className="h-5 w-5" />
                  </span>
                  <span className="text-xs font-medium text-muted">{showAll ? "Less" : "More"}</span>
                </button>
              )}
            </Card>
          </>
        )}

        <SectionTitle right={pendingCount > 0 && <span className="text-xs font-medium text-muted">{pendingCount} active</span>}>
          Pending payments
        </SectionTitle>
        {!deals ? (
          <Loading />
        ) : pendingCount === 0 ? (
          <EmptyState title="You're all caught up" icon={<ShieldIcon className="h-6 w-6" />}>
            Payments you start or request will show up here.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {drafts.map((d) => {
              const iAmBuyer = d.buyer.toLowerCase() === me;
              const other = iAmBuyer ? d.sellerName : d.buyerName;
              const myTerms = iAmBuyer ? d.buyerTerms : d.sellerTerms;
              const [label, cta] = !myTerms
                ? ["Add your terms", "Add terms"]
                : d.status === "awaiting_other"
                  ? [`Waiting for ${(other || "").split(" ")[0]}`, "View"]
                  : ["Agreement to sign", "Review & sign"];
              return (
                <Card key={d.id} flush>
                  <ListRow
                    href={`/pay/agreement/${d.id}`}
                    leading={<Avatar name={other} />}
                    title={other}
                    subtitle={`${iAmBuyer ? "You pay" : "You receive"} · ${d.purpose}`}
                    trailing={<p className="num text-[15px] font-semibold">{fmtInr(d.price)}</p>}
                  />
                  <div className="flex items-center justify-between gap-2 border-t border-line/70 px-4 py-3 sm:px-5">
                    <Badge tone={d.status === "awaiting_other" && myTerms ? "neutral" : "warning"}>{label}</Badge>
                    <ButtonLink size="sm" variant="soft" href={`/pay/agreement/${d.id}`}>
                      {cta}
                    </ButtonLink>
                  </div>
                </Card>
              );
            })}
            {inProgress.map((d) => (
              <PendingCard key={d.id} deal={d} iAmBuyer={d.buyer.toLowerCase() === me} />
            ))}
          </div>
        )}
      </Screen>
    </>
  );
}

function Action({ href, icon, label, sub }: { href: string; icon: ReactNode; label: string; sub: string }) {
  return (
    <Link href={href} className="group flex flex-col items-center gap-2 rounded-2xl px-0.5 py-3 text-center transition hover:bg-surface-2">
      <span className="grid h-12 w-12 place-items-center sm:h-14 sm:w-14 rounded-2xl bg-accent-soft text-accent transition group-hover:scale-105 group-active:scale-95">
        {icon}
      </span>
      <span>
        <span className="block text-sm font-semibold tracking-tight">{label}</span>
        <span className="hidden text-xs text-muted sm:block">{sub}</span>
      </span>
    </Link>
  );
}

function PendingCard({ deal, iAmBuyer }: { deal: Deal; iAmBuyer: boolean }) {
  const other = iAmBuyer ? deal.sellerName : deal.buyerName;
  const base = `/txn/${deal.id}`;
  const complaintOpen = COMPLAINT_OPEN.includes(deal.status);

  return (
    <Card flush>
      <ListRow
        href={base}
        leading={<Avatar name={other} />}
        title={other}
        subtitle={`${iAmBuyer ? "You pay" : "You receive"} · ${deal.title}`}
        trailing={
          <>
            <p className="num text-[15px] font-semibold">{fmtInr(deal.amount)}</p>
            <p className="text-xs text-muted">{fmtDate(initiatedAt(deal))}</p>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 border-t border-line/70 px-4 py-3 sm:px-5">
        <StatusChip status={deal.status} />
        <div className="ml-auto flex gap-2">
          {deal.status === "Accepted" && iAmBuyer && (
            <ButtonLink size="sm" href={`${base}/pay`}>
              Pay now
            </ButtonLink>
          )}
          {deal.status === "Funded" && !iAmBuyer && (
            <ButtonLink size="sm" variant="soft" href={base}>
              Mark delivered
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
