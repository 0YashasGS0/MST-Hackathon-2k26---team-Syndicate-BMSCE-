// Presentational building blocks. No hooks here, so they work in server and client components.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { DealStatus } from "@/lib/types";
import { initials, statusText, type Tone } from "@/lib/format";

export const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

/** Centred column: full width on phones, a comfortable reading width on laptops. */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-2xl px-4 pb-16 sm:px-6", className)}>{children}</div>;
}

/** App bar for inner screens: back arrow + title, like a UPI app. */
export function BackBar({ href, title, right }: { href: string; title?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-2 sm:px-4">
        <Link href={href} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full hover:bg-surface-2">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
        {right}
      </div>
    </header>
  );
}

/** `flush` drops the padding, for cards whose rows are links with their own padding. */
export function Card({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-surface", !flush && "p-4 sm:p-5", className)}>{children}</section>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-8 flex items-center justify-between px-1">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-line bg-surface hover:bg-surface-2",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
  ghost: "text-accent hover:bg-accent/10",
};
const sizes = { md: "px-4 py-2.5 text-sm", lg: "px-5 py-3.5 text-base", sm: "px-3 py-1.5 text-xs" };
const btn =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

type BtnProps = { variant?: Variant; size?: keyof typeof sizes };

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & BtnProps) {
  return <button className={cx(btn, variants[variant], sizes[size], className)} {...p} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & BtnProps) {
  return <Link className={cx(btn, variants[variant], sizes[size], className)} {...p} />;
}

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  info: "bg-info/15 text-info",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function StatusChip({ status }: { status: DealStatus }) {
  const s = statusText[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const avatarColors = ["bg-emerald-600", "bg-sky-600", "bg-violet-600", "bg-amber-600", "bg-rose-600", "bg-teal-600"];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const color = avatarColors[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % avatarColors.length];
  const dim = { sm: "h-8 w-8 text-xs", md: "h-11 w-11 text-sm", lg: "h-16 w-16 text-xl" }[size];
  return <span className={cx("grid shrink-0 place-items-center rounded-full font-semibold text-white", color, dim)}>{initials(name)}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-3 text-base outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent/20 sm:text-sm";

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line p-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent" />
      {label}
    </div>
  );
}

/** Label / value row for detail sheets. */
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{children}</dd>
    </div>
  );
}
