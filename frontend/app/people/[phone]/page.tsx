"use client";
// All payments with one person, as a chat (GPay style): money you send sits on the right, money you
// receive on the left, in different shades. Tap a bubble for the full transaction.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fmtDate, fmtInr, initiatedAt, isSettled, releasedAt } from "@/lib/format";
import type { Contact, Deal, Draft } from "@/lib/types";
import { useUser } from "@/components/session";
import { RequestIcon, SendIcon } from "@/components/icons";
import { Avatar, BackBar, ButtonLink, cx, Loading, StatusChip } from "@/components/ui";

type Item =
  | { kind: "deal"; at: number; sent: boolean; deal: Deal }
  | { kind: "draft"; at: number; sent: boolean; draft: Draft };

export default function PersonPage() {
  const { phone } = useParams<{ phone: string }>();
  const user = useUser();
  const [contact, setContact] = useState<Contact | null>();
  const [items, setItems] = useState<Item[]>();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.lookupContact(phone).then(async (c) => {
      setContact(c);
      if (!c) return setItems([]);
      const other = c.address.toLowerCase();
      const me = user.address.toLowerCase();
      const [deals, drafts] = await Promise.all([api.listDeals(user.address), api.listDrafts(user.address)]);
      const with_ = (b: string, s: string) => (b === me && s === other) || (s === me && b === other);
      setItems(
        [
          ...deals
            .filter((d) => with_(d.buyer.toLowerCase(), d.seller.toLowerCase()))
            .map((d) => ({ kind: "deal" as const, at: initiatedAt(d), sent: d.buyer.toLowerCase() === me, deal: d })),
          ...drafts
            .filter((d) => with_(d.buyer.toLowerCase(), d.seller.toLowerCase()))
            .map((d) => ({ kind: "draft" as const, at: d.createdAt, sent: d.buyer.toLowerCase() === me, draft: d })),
        ].sort((a, b) => a.at - b.at),
      );
    });
  }, [phone, user.address]);

  // Open at the latest message, like a chat.
  useEffect(() => {
    if (items?.length) bottom.current?.scrollIntoView({ block: "end" });
  }, [items]);

  if (contact === undefined || !items)
    return (
      <>
        <BackBar href="/home" title="" />
        <Loading />
      </>
    );
  if (!contact)
    return (
      <>
        <BackBar href="/home" title="Not found" />
        <p className="p-6 text-center text-muted">No Yescro account with this number.</p>
      </>
    );

  const first = contact.name.split(" ")[0];

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line/70 bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-2xl items-center gap-3 px-2 sm:px-4">
          <BackArrow />
          <Avatar name={contact.name} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold tracking-tight">{contact.name}</p>
            <p className="truncate text-xs text-muted">
              {contact.bankingName} · +91 {contact.phone}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 pb-28 pt-4 sm:px-6">
        {items.length === 0 && (
          <p className="mt-16 text-center text-sm text-muted">No payments with {first} yet. Start one below.</p>
        )}
        {items.map((it, i) => {
          const day = fmtDate(it.at);
          const showDay = i === 0 || day !== fmtDate(items[i - 1].at);
          return (
            <div key={`${it.kind}-${it.kind === "deal" ? it.deal.id : it.draft.id}`}>
              {showDay && (
                <p className="my-4 text-center">
                  <span className="rounded-full bg-surface-2 px-3 py-1 text-[11px] font-medium text-muted">{day}</span>
                </p>
              )}
              <Bubble item={it} first={first} />
            </div>
          );
        })}
        <div ref={bottom} />
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line/70 bg-surface/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl gap-3 px-4 py-3 sm:px-6">
          <ButtonLink className="flex-1" href={`/pay/new?to=${contact.phone}&role=buyer`}>
            <SendIcon className="h-4 w-4" /> Pay
          </ButtonLink>
          <ButtonLink className="flex-1" variant="secondary" href={`/pay/new?to=${contact.phone}&role=seller`}>
            <RequestIcon className="h-4 w-4" /> Request
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}

function Bubble({ item, first }: { item: Item; first: string }) {
  const sent = item.sent;
  const href = item.kind === "deal" ? `/txn/${item.deal.id}` : `/pay/agreement/${item.draft.id}`;
  const amount = item.kind === "deal" ? item.deal.amount : item.draft.price;
  const title = item.kind === "deal" ? item.deal.title : item.draft.purpose;
  const settled = item.kind === "deal" && isSettled(item.deal);
  const when = item.kind === "deal" ? (releasedAt(item.deal) ?? item.at) : item.at;

  const label =
    item.kind === "draft"
      ? sent
        ? "You're paying · agreement in progress"
        : `${first} is paying · agreement in progress`
      : settled
        ? sent
          ? `Paid to ${first}`
          : `Received from ${first}`
        : sent
          ? `You're paying ${first}`
          : `${first} is paying you`;

  return (
    <div className={cx("mb-3 flex", sent ? "justify-end" : "justify-start")}>
      <Link
        href={href}
        className={cx(
          "w-[78%] max-w-xs rounded-3xl px-4 py-3.5 shadow-card ring-1 transition hover:brightness-[0.98] sm:w-72",
          sent ? "rounded-br-lg bg-accent-soft ring-accent/20" : "rounded-bl-lg bg-surface ring-line/60",
        )}
      >
        <p className="text-xs text-muted">{label}</p>
        <p className={cx("num mt-1 text-2xl font-semibold", !sent && settled && "text-success")}>{fmtInr(amount)}</p>
        <p className="mt-0.5 truncate text-sm">{title}</p>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          {item.kind === "deal" ? (
            <StatusChip status={item.deal.status} />
          ) : (
            <span className="rounded-full bg-warning/10 px-2.5 py-1 text-[11px] font-semibold text-warning">Agree terms</span>
          )}
          <span className="text-[11px] text-muted">{new Date(when * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}</span>
        </div>
      </Link>
    </div>
  );
}

function BackArrow() {
  return (
    <Link href="/home" aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full hover:bg-surface-2">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </Link>
  );
}
