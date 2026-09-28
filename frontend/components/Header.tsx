"use client";
import { useEffect, useRef, useState } from "react";
import { maskPhone } from "@/lib/format";
import { useUser, useSession } from "./session";
import { Avatar } from "./ui";

export const APP_NAME = "Sakshi"; // working name — TBD

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
      {/* eslint-disable-next-line @next/next/no-img-element -- tiny static svg */}
      <img src="/icon.svg" alt="" className="h-8 w-8" />
      {APP_NAME}
    </span>
  );
}

/** Home screen header: logo and profile menu. Inner screens use <BackBar>. */
export function Header() {
  const user = useUser();
  const { signOut } = useSession();
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const name = user.name ?? "My account";

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => menu.current && !menu.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="relative" ref={menu}>
          <button onClick={() => setOpen((o) => !o)} aria-label="Profile" className="rounded-full ring-accent/30 focus:ring-4">
            <Avatar name={name} size="sm" />
          </button>
          {open && (
            <div className="absolute right-0 mt-2 w-64 rounded-2xl border border-line bg-surface p-2 shadow-lg">
              <div className="flex items-center gap-3 p-2">
                <Avatar name={name} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{name}</p>
                  <p className="text-xs text-muted">{maskPhone(user.phone)}</p>
                </div>
              </div>
              <p className="px-2 pb-2 text-xs text-muted">This device is registered to your number.</p>
              <button
                onClick={() => signOut()}
                className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-danger hover:bg-danger/10"
              >
                Log out of this device
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
