import Link from "next/link";
import { api } from "@/lib/api";
import { mst } from "@/lib/chain";
import { ESCROW_ADDRESS } from "@/lib/contracts";
import { fmtUsd, shortHex, txUrl } from "@/lib/format";

// Temporary scaffold check page: proves chain config + mocked API wiring. Replaced by the dashboard.
export default async function Home() {
  const deals = await api.listDeals("0x1111111111111111111111111111111111111111");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">Escrow — FE scaffold</h1>
      <p className="mt-1 text-sm text-zinc-500">
        {mst.name} · chain {mst.id} · explorer {mst.blockExplorers.default.url} · escrow{" "}
        {ESCROW_ADDRESS ?? "not deployed yet"}
      </p>

      <h2 className="mt-8 text-lg font-medium">Deals (mock API)</h2>
      <ul className="mt-3 divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {deals.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-4 p-3 text-sm">
            <span>
              #{d.id} {d.title} · {fmtUsd(d.amount)} mUSD
            </span>
            <span className="flex items-center gap-3">
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{d.status}</span>
              <Link className="text-blue-600 hover:underline" href={txUrl(d.events[0].txHash)} target="_blank">
                {shortHex(d.events[0].txHash)} ↗
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
