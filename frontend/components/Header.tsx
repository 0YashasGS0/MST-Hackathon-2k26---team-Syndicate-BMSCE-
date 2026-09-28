"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { mst } from "@/lib/chain";
import { shortHex } from "@/lib/format";
import { useSession } from "./session";

export const APP_NAME = "Sakshi"; // working name — TBD

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/deals/new", label: "New deal" },
  { href: "/kyc", label: "KYC" },
  { href: "/arbitrator", label: "Arbitrator" },
];

export function Header() {
  const path = usePathname();
  const { address, connecting, connect, disconnect } = useSession();

  return (
    <header className="sticky top-0 z-10 border-b border-line bg-surface/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm text-accent-fg">S</span>
          {APP_NAME}
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {nav.map((n) => {
            const active = path === n.href || (n.href !== "/" && path.startsWith(n.href + "/"));
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-md px-3 py-1.5 text-sm ${active ? "bg-surface-2 font-medium" : "text-muted hover:text-foreground"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            {mst.name}
          </span>
          {address ? (
            <button
              onClick={disconnect}
              title="Disconnect"
              className="rounded-lg border border-line px-3 py-1.5 font-mono text-xs hover:bg-surface-2"
            >
              {shortHex(address)}
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg disabled:opacity-50"
            >
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          )}
        </div>
      </div>

      {/* mobile nav */}
      <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 md:hidden">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="whitespace-nowrap rounded-md px-3 py-1 text-sm text-muted">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
