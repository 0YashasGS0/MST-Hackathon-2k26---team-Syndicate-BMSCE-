"use client";
// Completed payments, grouped by month (GPay style). Tapping one opens its details.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fmtDate, fmtInr, fmtMonth, initiatedAt, isSettled, releasedAt } from "@/lib/format";
import type { Deal } from "@/lib/types";
import { useUser } from "@/components/session";
import { HistoryIcon, SearchIcon } from "@/components/icons";
import { Avatar, BackBar, Card, cx, EmptyState, ListRow, Loading, Screen } from "@/components/ui";

type Filter = "all" | "paid" | "received";
const filters: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "paid", label: "Paid" },
  { key: "received", label: "Received" },
];

export default function HistoryPage() {
  const user = useUser();
  const me = user.address.toLowerCase();
  const [deals, setDeals] = useState<Deal[]>();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  useEffect(() => {
    api.listDeals(user.address).then(setDeals);
  }, [user.address]);

  const when = (d: Deal) => releasedAt(d) ?? initiatedAt(d);
  const q = query.trim().toLowerCase();
  const list = (deals ?? [])
    .filter(isSettled)
    .filter((d) => {
      const received = d.seller.toLowerCase() === me;
      if (filter === "paid" && received) return false;
      if (filter === "received" && !received) return false;
      return !q || [d.title, d.buyerName, d.sellerName].some((s) => s.toLowerCase().includes(q));
    })
    .sort((a, b) => when(b) - when(a));

  const groups = new Map<string, Deal[]>();
  for (const d of list) groups.set(fmtMonth(when(d)), [...(groups.get(fmtMonth(when(d))) ?? []), d]);

  return (
    <>
      <BackBar href="/home" title="Payment history" />
      <Screen className="pt-5">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or purpose"
            aria-label="Search payments"
            className="w-full rounded-full bg-surface py-3.5 pl-12 pr-4 text-[15px] shadow-card outline-none ring-1 ring-line/60 placeholder:text-muted/70 focus:ring-2 focus:ring-accent/40"
          />
        </div>

        <div className="mt-4 flex gap-2">
          {filters.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cx(
                "h-9 rounded-full px-4 text-sm font-semibold transition",
                filter === f.key ? "bg-foreground text-background" : "bg-surface text-muted ring-1 ring-line hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {!deals ? (
            <Loading />
          ) : list.length === 0 ? (
            <EmptyState title={q || filter !== "all" ? "No matching payments" : "No payments yet"} icon={<HistoryIcon className="h-6 w-6" />}>
              {q || filter !== "all" ? "Try a different search or filter." : "Completed payments will appear here."}
            </EmptyState>
          ) : (
            <div className="space-y-6">
              {[...groups].map(([month, items]) => (
                <section key={month}>
                  <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted">{month}</p>
                  <Card flush className="divide-y divide-line/70">
                    {items.map((d) => {
                      const received = d.seller.toLowerCase() === me;
                      const other = received ? d.buyerName : d.sellerName;
                      return (
                        <ListRow
                          key={d.id}
                          href={`/txn/${d.id}`}
                          chevron={false}
                          leading={<Avatar name={other} />}
                          title={other}
                          subtitle={`${received ? "Received" : "Paid"} · ${fmtDate(when(d))}`}
                          trailing={
                            <p className={cx("num text-[15px] font-semibold", received && "text-success")}>
                              {received ? "+ " : ""}
                              {fmtInr(d.amount)}
                            </p>
                          }
                        />
                      );
                    })}
                  </Card>
                </section>
              ))}
            </div>
          )}
        </div>
      </Screen>
    </>
  );
}
