"use client";
// Security PIN UI: a 4-box input, a confirm sheet for money actions, and the app lock screen.
import { useEffect, useRef, useState } from "react";
import { maskPhone } from "@/lib/format";
import { LockIcon } from "./icons";
import { Avatar, cx } from "./ui";

export const PIN_LENGTH = 4;

/** Four masked boxes over one hidden numeric input. Calls onComplete once all digits are in. */
export function PinInput({
  value,
  onChange,
  onComplete,
  autoFocus = true,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  autoFocus?: boolean;
  error?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="relative mx-auto w-fit" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        autoFocus={autoFocus}
        inputMode="numeric"
        autoComplete="off"
        type="password"
        maxLength={PIN_LENGTH}
        value={value}
        aria-label="Security PIN"
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH);
          onChange(v);
          if (v.length === PIN_LENGTH) onComplete?.(v);
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
      <div className="flex gap-3">
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <span
            key={i}
            className={cx(
              "grid h-14 w-12 place-items-center rounded-2xl border-2 bg-surface text-2xl transition",
              error ? "border-danger" : i === value.length ? "border-accent" : i < value.length ? "border-accent/40" : "border-line",
            )}
          >
            {i < value.length ? "•" : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Bottom sheet asking for the PIN before a money action. `onSubmit` throws to show an error. */
export function PinSheet({
  title,
  subtitle,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle?: string;
  onSubmit: (pin: string) => Promise<void>;
  onClose: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  async function submit(p: string) {
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPin("");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm sm:items-center" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-t-3xl bg-surface p-6 pb-10 text-center shadow-raised sm:rounded-3xl sm:pb-6"
      >
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-accent-soft text-accent">
          <LockIcon className="h-6 w-6" />
        </span>
        <p className="mt-3 text-lg font-semibold tracking-tight">{title}</p>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-6">
          <PinInput value={pin} onChange={setPin} onComplete={submit} error={!!error} />
        </div>
        <p className={cx("mt-4 min-h-5 text-sm", error ? "text-danger" : "text-muted")}>
          {busy ? "Verifying…" : error ?? "Enter your 4-digit security PIN"}
        </p>
        <button type="button" onClick={onClose} disabled={busy} className="mt-4 text-sm font-medium text-muted hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** Full-screen app lock shown every time the app is opened, like UPI apps. */
export function LockScreen({
  name,
  phone,
  onUnlock,
  onForgot,
}: {
  name: string;
  phone: string;
  onUnlock: (pin: string) => Promise<void>;
  onForgot: () => void;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(p: string) {
    setBusy(true);
    setError(undefined);
    try {
      await onUnlock(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPin("");
      setBusy(false);
    }
  }

  return (
    <div className="hero-gradient flex min-h-dvh flex-col items-center justify-center px-6 text-center text-white">
      <div className="rounded-full ring-4 ring-white/20">
        <Avatar name={name} size="lg" />
      </div>
      <p className="mt-4 text-xl font-semibold tracking-tight">{name}</p>
      <p className="text-sm text-white/70">{maskPhone(phone)}</p>
      <div className="mt-10 rounded-3xl bg-surface p-6 text-foreground shadow-raised">
        <p className="mb-5 text-sm font-medium">Enter your security PIN to unlock</p>
        <PinInput value={pin} onChange={setPin} onComplete={submit} error={!!error} />
        <p className={cx("mt-4 min-h-5 text-sm", error ? "text-danger" : "text-muted")}>{busy ? "Unlocking…" : error ?? " "}</p>
      </div>
      <button onClick={onForgot} className="mt-8 text-sm text-white/75 underline-offset-4 hover:underline">
        Not you? Log out
      </button>
    </div>
  );
}
