// Presentational building blocks. No hooks here, so they work in server and client components.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import type { DealStatus } from "@/lib/types";
import { initials, statusText, type Tone } from "@/lib/format";
import { ChevronLeft, ChevronRight } from "./icons";

export const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(" ");

/** Centred column: full width on phones, a comfortable reading width on laptops. */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-2xl px-4 pb-20 sm:px-6", className)}>{children}</div>;
}

/** App bar for inner screens: back arrow + title, like a UPI app. */
export function BackBar({ href, title, right }: { href: string; title?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line/70 bg-surface/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-2xl items-center gap-1 px-2 sm:px-4">
        <Link href={href} aria-label="Back" className="grid h-10 w-10 place-items-center rounded-full text-foreground hover:bg-surface-2">
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex-1 truncate text-[15px] font-semibold tracking-tight">{title}</h1>
        {right}
      </div>
    </header>
  );
}

/** `flush` drops the padding, for cards whose rows are links with their own padding. */
export function Card({ children, className, flush }: { children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <section className={cx("overflow-hidden rounded-3xl bg-surface shadow-card ring-1 ring-line/60", !flush && "p-5 sm:p-6", className)}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-9 flex items-end justify-between px-1">
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

type Variant = "primary" | "secondary" | "danger" | "ghost" | "soft";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg shadow-sm hover:bg-accent-strong",
  secondary: "bg-surface text-foreground ring-1 ring-line hover:bg-surface-2",
  danger: "bg-danger/10 text-danger hover:bg-danger/15",
  ghost: "text-accent hover:bg-accent-soft",
  soft: "bg-accent-soft text-accent hover:brightness-95",
};
const sizes = { md: "h-11 px-5 text-sm", lg: "h-[52px] px-6 text-[15px]", sm: "h-8 px-3.5 text-xs" };
const btn =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold tracking-tight transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";

type BtnProps = { variant?: Variant; size?: keyof typeof sizes };

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & BtnProps) {
  return <button className={cx(btn, variants[variant], sizes[size], className)} {...p} />;
}

export function ButtonLink({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & BtnProps) {
  return <Link className={cx(btn, variants[variant], sizes[size], className)} {...p} />;
}

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  info: "bg-info/10 text-info",
};
const dots: Record<Tone, string> = {
  neutral: "bg-muted",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold", tones[tone])}>
      <span className={cx("h-1.5 w-1.5 rounded-full", dots[tone])} />
      {children}
    </span>
  );
}

export function StatusChip({ status }: { status: DealStatus }) {
  const s = statusText[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

const avatarColors = [
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-teal-100 text-teal-800",
];

export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  const color = avatarColors[[...name].reduce((s, c) => s + c.charCodeAt(0), 0) % avatarColors.length];
  const dim = { sm: "h-9 w-9 text-xs", md: "h-11 w-11 text-sm", lg: "h-16 w-16 text-lg" }[size];
  return (
    <span className={cx("grid shrink-0 place-items-center rounded-full font-semibold tracking-tight", color, dim)}>
      {initials(name)}
    </span>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-2xl border border-transparent bg-surface-2 px-4 py-3.5 text-base text-foreground outline-none transition placeholder:text-muted/70 focus:border-accent/40 focus:bg-surface focus:ring-4 focus:ring-accent/10 sm:text-[15px]";

/** A labelled input row with a leading icon, used on form cards. */
export function IconField({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <label className="flex items-start gap-3.5 px-5 py-4 sm:px-6">
      <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium text-muted">{label}</span>
        {children}
      </span>
    </label>
  );
}
/** Bare input for use inside <IconField>. */
export const bareInputCls =
  "mt-0.5 w-full resize-none bg-transparent text-base font-medium text-foreground outline-none placeholder:font-normal placeholder:text-muted/60 sm:text-[15px]";

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="rounded-3xl bg-surface px-6 py-10 text-center shadow-card ring-1 ring-line/60">
      {icon && <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-muted">{icon}</div>}
      <p className="font-semibold">{title}</p>
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
    <div className="flex items-start justify-between gap-4 py-3.5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-semibold">{children}</dd>
    </div>
  );
}

/** Tappable list row: avatar, two lines of text, trailing content, chevron. */
export function ListRow({
  href,
  leading,
  title,
  subtitle,
  trailing,
  chevron = true,
}: {
  href: string;
  leading: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
}) {
  return (
    <Link href={href} className="group flex items-center gap-3.5 px-4 py-3.5 transition hover:bg-surface-2/70 sm:px-5">
      {leading}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold tracking-tight">{title}</p>
        {subtitle && <p className="truncate text-[13px] text-muted">{subtitle}</p>}
      </div>
      {trailing && <div className="shrink-0 text-right">{trailing}</div>}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-muted/60 transition group-hover:translate-x-0.5" />}
    </Link>
  );
}
