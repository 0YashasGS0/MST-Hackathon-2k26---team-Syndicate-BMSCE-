"use client";
import Link from "next/link";
import { initials } from "@/lib/format";
import { useUser } from "./session";
import { cx } from "./ui";

export const APP_NAME = "Sakshi"; // working name — TBD

export function Logo({ onDark }: { onDark?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static svg */}
      <img src="/icon.svg" alt="" className={cx("h-8 w-8 rounded-[10px]", onDark && "ring-2 ring-white/25")} />
      {APP_NAME}
    </span>
  );
}

/** Home screen header on the green hero band: logo and the account button. Inner screens use <BackBar>. */
export function Header() {
  const user = useUser();
  return (
    <header className="relative z-20 text-white">
      <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
        <Logo onDark />
        <Link
          href="/account"
          aria-label="Account"
          className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-sm font-semibold ring-1 ring-white/25 transition hover:bg-white/25"
        >
          {initials(user.name ?? "Me")}
        </Link>
      </div>
    </header>
  );
}
