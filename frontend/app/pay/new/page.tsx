"use client";
// Pay or request money. The mode comes from the button tapped on home (or the QR that was scanned):
// ?role=buyer|seller, and ?to=<phone> pre-selects the other person.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { parseUnits } from "viem";
import { api } from "@/lib/api";
import { USD_DECIMALS } from "@/lib/contracts";
import { INR_PER_USD } from "@/lib/format";
import type { Contact, Party } from "@/lib/types";
import { useUser } from "@/components/session";
import { CheckIcon, DocIcon, PhoneIcon, ShieldIcon, TagIcon } from "@/components/icons";
import { Avatar, BackBar, bareInputCls, Button, Card, cx, IconField, Loading, Screen } from "@/components/ui";

const copy = {
  buyer: {
    title: "Pay",
    amountLabel: "You pay",
    person: "Pay to",
    note: "Held safely until you approve the work",
    terms: "What should be delivered?",
    termsPlaceholder: "Deadline, must-haves, quality. e.g. Works on mobile, done in 5 days, includes an order form.",
    cta: "Continue",
  },
  seller: {
    title: "Request money",
    amountLabel: "You receive",
    person: "Request from",
    note: "They pay now; you receive it once they approve the work",
    terms: "What will you deliver?",
    termsPlaceholder: "Scope, timeline, what's not included. e.g. Landing page + order form in 7 days, hosting not included.",
    cta: "Send request",
  },
};

export default function NewPaymentPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewPayment />
    </Suspense>
  );
}

function NewPayment() {
  const router = useRouter();
  const user = useUser();
  const params = useSearchParams();
  const role: Party = params.get("role") === "seller" ? "seller" : "buyer";
  const fixedTo = params.get("to") ?? "";
  const t = copy[role];

  const [phone, setPhone] = useState(fixedTo);
  const [contact, setContact] = useState<Contact | null>();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  // Look the person up as soon as a full mobile number is entered.
  useEffect(() => {
    if (phone.length !== 10) return;
    let live = true;
    api.lookupContact(phone).then((c) => live && setContact(c));
    return () => {
      live = false;
      setContact(undefined);
    };
  }, [phone]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(undefined);
    try {
      const draft = await api.createDraft(user.address, {
        role,
        counterpartyPhone: phone,
        purpose: String(f.get("purpose")),
        price: parseUnits((Number(amount) / INR_PER_USD).toFixed(USD_DECIMALS), USD_DECIMALS).toString(),
        terms: String(f.get("terms")),
      });
      router.push(`/pay/agreement/${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  const isSelf = phone === user.phone;
  const verified = phone.length === 10 && !!contact && !isSelf;

  return (
    <>
      <BackBar href="/home" title={t.title} />
      <Screen className="pt-5">
        <form onSubmit={submit} className="space-y-4">
          {/* who: like GPay, the KYC banking name is shown before anything else can be entered */}
          <Card flush>
            {!fixedTo && (
              <IconField icon={<PhoneIcon className="h-5 w-5" />} label={t.person}>
                <input
                  required
                  autoFocus
                  inputMode="numeric"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  className={bareInputCls + " tracking-wide"}
                  placeholder="Enter mobile number"
                />
              </IconField>
            )}
            {phone.length === 10 && contact === undefined && (
              <p className="border-t border-line/70 px-5 py-4 text-sm text-muted sm:px-6">Looking up this number…</p>
            )}
            {phone.length === 10 && contact !== undefined && (isSelf || !contact) && (
              <p className="border-t border-line/70 px-5 py-4 text-sm font-medium text-danger sm:px-6">
                {isSelf ? "That's your own number." : "No verified Sakshi account with this number."}
              </p>
            )}
            {verified && contact && (
              <div className={cx("flex items-center gap-3.5 px-5 py-4 sm:px-6", !fixedTo && "border-t border-line/70")}>
                <Avatar name={contact.name} />
                <div className="min-w-0 flex-1">
                  {fixedTo && <p className="text-xs font-medium text-muted">{t.person}</p>}
                  <p className="flex items-center gap-1.5 text-[15px] font-semibold">
                    <span className="truncate">{contact.name}</span>
                    <span title="KYC verified" className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-success text-white">
                      <CheckIcon className="h-3 w-3" strokeWidth={3} />
                    </span>
                  </p>
                  <p className="text-xs text-muted">
                    Banking name: <span className="font-semibold text-foreground">{contact.bankingName}</span>
                  </p>
                  <p className="text-xs text-muted">+91 {contact.phone} · KYC verified</p>
                </div>
              </div>
            )}
          </Card>

          {verified && (
            <>
              {/* amount */}
              <Card className="text-center">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">{t.amountLabel}</p>
                <label className="mt-2 flex items-baseline justify-center">
                  <span className={cx("mr-1 text-3xl font-semibold sm:text-4xl", amount ? "text-foreground" : "text-muted/50")}>₹</span>
                  <input
                    required
                    autoFocus
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="0"
                    aria-label="Amount in rupees"
                    style={{ width: `${Math.max(amount.length, 1) + 0.3}ch` }}
                    className="num max-w-[9ch] bg-transparent text-5xl font-semibold outline-none placeholder:text-muted/40 sm:text-6xl"
                  />
                </label>
              </Card>

              {/* what */}
              <Card flush className="divide-y divide-line/70">
                <IconField icon={<TagIcon className="h-5 w-5" />} label="For">
                  <input name="purpose" required className={bareInputCls} placeholder="e.g. Landing page for a bakery" />
                </IconField>
                <IconField icon={<DocIcon className="h-5 w-5" />} label={t.terms}>
                  <textarea name="terms" required rows={3} className={bareInputCls} placeholder={t.termsPlaceholder} />
                </IconField>
              </Card>

              <p className="flex items-center justify-center gap-2 text-center text-xs text-muted">
                <ShieldIcon className="h-4 w-4 shrink-0 text-accent" />
                {t.note}
              </p>

              {error && <p className="text-center text-sm text-danger">{error}</p>}
              <Button size="lg" className="w-full" disabled={busy || !(Number(amount) > 0)}>
                {busy ? "Sending…" : t.cta}
              </Button>
            </>
          )}
        </form>
      </Screen>
    </>
  );
}
