"use client";
// Checkout: UPI QR, UPI ID collect request, UPI app (phones), or a linked crypto wallet.
// Every method ends in the same place: the money is locked in escrow until the payer approves the work.
import QRCode from "qrcode";
import { useParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import type { Address, EIP1193Provider } from "viem";
import { api } from "@/lib/api";
import { fmtInr, txnId } from "@/lib/format";
import type { OnrampSession, PayMethod } from "@/lib/types";
import { useSession, useUser } from "@/components/session";
import { useDeal } from "@/components/useDeal";
import { CheckIcon, ChevronRight, ShieldIcon } from "@/components/icons";
import {
  BhimMark,
  GPayMark,
  PaytmMark,
  PhonePeMark,
  UpiMark,
  WalletMark,
} from "@/components/PayMarks";
import { Avatar, BackBar, Button, ButtonLink, Card, cx, inputCls, Loading, Screen, SectionTitle } from "@/components/ui";

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { isMetaMask?: boolean };
  }
}

const methodLabel: Record<PayMethod, string> = {
  upi_qr: "UPI (QR)",
  upi_id: "UPI ID",
  upi_app: "UPI app",
  crypto: "Crypto wallet",
};

export default function PayPage() {
  const { id } = useParams<{ id: string }>();
  const { deal } = useDeal(id);
  const [session, setSession] = useState<OnrampSession>();
  const [open, setOpen] = useState<PayMethod>("upi_qr");
  const [paying, setPaying] = useState(false);
  const [paidWith, setPaidWith] = useState<PayMethod>();
  const [error, setError] = useState<string>();
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    api.onrampSession(id).then(setSession, (e) => setError(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time device check
    setMobile(window.matchMedia("(pointer: coarse)").matches);
  }, [id]);

  async function confirm(method: PayMethod) {
    setPaying(true);
    setError(undefined);
    try {
      await api.onrampConfirm(id, method);
      setPaidWith(method);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPaying(false);
    }
  }

  if (!deal || !session)
    return (
      <>
        <BackBar href="/home" title="Pay" />
        {error ? <p className="p-6 text-center text-danger">{error}</p> : <Loading />}
      </>
    );

  const alreadyPaid = deal.status !== "Accepted";
  if (paidWith || alreadyPaid)
    return (
      <Screen className="flex min-h-dvh flex-col items-center justify-center text-center">
        <div className="grid h-24 w-24 place-items-center rounded-full bg-success text-white shadow-raised">
          <CheckIcon className="h-12 w-12" strokeWidth={2.5} />
        </div>
        <p className="num mt-6 text-5xl font-semibold">{fmtInr(deal.amount)}</p>
        <p className="mt-1 text-muted">
          paid to {deal.sellerName}
          {paidWith || deal.paidWith ? ` via ${methodLabel[(paidWith ?? deal.paidWith)!]}` : ""}
        </p>
        <Card className="mt-6 w-full max-w-sm text-left">
          <p className="flex gap-2 text-sm">
            <ShieldIcon className="h-5 w-5 shrink-0 text-accent" />
            <span>
              Your money is <b>held safely</b>. {deal.sellerName.split(" ")[0]} gets it only after you confirm the work is done.
            </span>
          </p>
          <p className="mt-3 text-xs text-muted">
            Transaction ID · <span className="font-mono">{txnId(deal.id)}</span>
          </p>
        </Card>
        <ButtonLink size="lg" href="/home" className="mt-8 w-full max-w-sm">
          Done
        </ButtonLink>
      </Screen>
    );

  const methods: { key: PayMethod; title: string; sub: string; marks: ReactNode; body: ReactNode; hide?: boolean }[] = [
    {
      key: "upi_qr",
      title: "Scan & pay with any UPI app",
      sub: "Show this QR to GPay, PhonePe, Paytm or BHIM",
      marks: <UpiMark />,
      body: <UpiQr uri={session.upiUri} busy={paying} onPaid={() => confirm("upi_qr")} />,
    },
    {
      key: "upi_app",
      title: "Pay with a UPI app",
      sub: "Opens the UPI app on this phone",
      marks: (
        <>
          <GPayMark />
          <PhonePeMark />
          <PaytmMark />
          <BhimMark />
        </>
      ),
      body: <UpiApp uri={session.upiUri} busy={paying} onPaid={() => confirm("upi_app")} />,
      hide: !mobile,
    },
    {
      key: "upi_id",
      title: "Pay using UPI ID",
      sub: "Get a payment request in your UPI app",
      marks: <UpiMark />,
      body: <UpiId busy={paying} onPaid={() => confirm("upi_id")} />,
    },
    {
      key: "crypto",
      title: "Crypto wallet",
      sub: "Pay in stablecoin from your linked wallet",
      marks: <WalletMark />,
      body: <Crypto amount={fmtInr(deal.amount)} busy={paying} onPaid={() => confirm("crypto")} />,
    },
  ];

  return (
    <>
      <BackBar href={`/txn/${id}`} title="Choose how to pay" />
      <Screen className="pt-5">
        <Card className="flex items-center gap-4">
          <Avatar name={deal.sellerName} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">Paying</p>
            <p className="truncate text-[15px] font-semibold">{deal.sellerName}</p>
            <p className="truncate text-xs text-muted">{deal.title}</p>
          </div>
          <p className="num text-2xl font-semibold">{fmtInr(deal.amount)}</p>
        </Card>

        <SectionTitle>Payment options</SectionTitle>
        <div className="space-y-3">
          {methods
            .filter((m) => !m.hide)
            .map((m) => {
              const isOpen = open === m.key;
              return (
                <Card key={m.key} flush className={cx(isOpen && "ring-2 ring-accent/40")}>
                  <button
                    type="button"
                    onClick={() => setOpen(m.key)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-3.5 px-5 py-4 text-left sm:px-6"
                  >
                    <span
                      className={cx(
                        "grid h-5 w-5 shrink-0 place-items-center rounded-full border-2",
                        isOpen ? "border-accent" : "border-line",
                      )}
                    >
                      {isOpen && <span className="h-2.5 w-2.5 rounded-full bg-accent" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold tracking-tight">{m.title}</span>
                      <span className="block text-[13px] text-muted">{m.sub}</span>
                    </span>
                    <span className="hidden shrink-0 items-center gap-1.5 sm:flex">{m.marks}</span>
                    <ChevronRight className={cx("h-4 w-4 shrink-0 text-muted transition", isOpen && "rotate-90")} />
                  </button>
                  {m.marks && <div className="-mt-2 flex flex-wrap gap-1.5 px-5 pb-3 pl-[3.35rem] sm:hidden">{m.marks}</div>}
                  {isOpen && <div className="border-t border-line/70 px-5 py-5 sm:px-6">{m.body}</div>}
                </Card>
              );
            })}
        </div>

        {error && <p className="mt-4 text-center text-sm text-danger">{error}</p>}
        <p className="mt-6 flex items-center justify-center gap-2 text-center text-xs text-muted">
          <ShieldIcon className="h-4 w-4 shrink-0 text-accent" />
          Money is locked safely and released only when you approve the work
        </p>
      </Screen>
    </>
  );
}

function UpiQr({ uri, busy, onPaid }: { uri: string; busy: boolean; onPaid: () => void }) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    QRCode.toDataURL(uri, { width: 480, margin: 1 }).then(setSrc);
  }, [uri]);
  return (
    <div className="text-center">
      <div className="mx-auto w-52 rounded-2xl bg-white p-3 ring-1 ring-line">
        {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
        {src ? <img src={src} alt="UPI payment QR" className="aspect-square w-full" /> : <div className="aspect-square" />}
      </div>
      <div className="mt-3 flex justify-center gap-1.5">
        <GPayMark />
        <PhonePeMark />
        <PaytmMark />
        <BhimMark />
      </div>
      <Button size="lg" className="mt-5 w-full" disabled={busy} onClick={onPaid}>
        {busy ? "Confirming payment…" : "I've paid"}
      </Button>
    </div>
  );
}

function UpiApp({ uri, busy, onPaid }: { uri: string; busy: boolean; onPaid: () => void }) {
  const [opened, setOpened] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        size="lg"
        className="w-full"
        onClick={() => {
          setOpened(true);
          window.location.href = uri;
        }}
      >
        Open UPI app
      </Button>
      {opened && (
        <Button size="lg" variant="secondary" className="w-full" disabled={busy} onClick={onPaid}>
          {busy ? "Confirming payment…" : "I've completed the payment"}
        </Button>
      )}
    </div>
  );
}

function UpiId({ busy, onPaid }: { busy: boolean; onPaid: () => void }) {
  const [vpa, setVpa] = useState("");
  const [sent, setSent] = useState(false);
  const [left, setLeft] = useState(300);
  const valid = /^[\w.-]{2,}@[a-z]{2,}$/i.test(vpa);

  useEffect(() => {
    if (!sent) return;
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [sent]);

  if (sent)
    return (
      <div className="text-center">
        <p className="text-sm">
          Payment request sent to <b>{vpa}</b>
        </p>
        <p className="mt-1 text-sm text-muted">Open your UPI app and approve it within</p>
        <p className="num mt-2 text-3xl font-semibold">
          {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </p>
        <Button size="lg" className="mt-5 w-full" disabled={busy || left === 0} onClick={onPaid}>
          {busy ? "Confirming payment…" : "I've approved it"}
        </Button>
        <button className="mt-3 text-sm font-medium text-accent" onClick={() => (setSent(false), setLeft(300))}>
          Use a different UPI ID
        </button>
      </div>
    );

  return (
    <div className="space-y-3">
      <input
        value={vpa}
        onChange={(e) => setVpa(e.target.value.trim())}
        className={inputCls}
        placeholder="yourname@okhdfcbank"
        autoCapitalize="none"
        aria-label="UPI ID"
      />
      <Button size="lg" className="w-full" disabled={!valid} onClick={() => setSent(true)}>
        Send payment request
      </Button>
    </div>
  );
}

function Crypto({ amount, busy, onPaid }: { amount: string; busy: boolean; onPaid: () => void }) {
  const user = useUser();
  const { updateUser } = useSession();
  const [linking, setLinking] = useState(false);
  const [error, setError] = useState<string>();
  const hasProvider = typeof window !== "undefined" && !!window.ethereum;

  async function link() {
    setLinking(true);
    setError(undefined);
    try {
      const [addr] = (await window.ethereum!.request({ method: "eth_requestAccounts" })) as Address[];
      updateUser(await api.linkWallet(user.phone, addr));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't link the wallet.");
    } finally {
      setLinking(false);
    }
  }

  if (!user.wallet)
    return (
      <div className="text-center">
        <p className="text-sm text-muted">Link a crypto wallet once to pay with stablecoins.</p>
        {hasProvider ? (
          <Button size="lg" variant="secondary" className="mt-4 w-full" disabled={linking} onClick={link}>
            {linking ? "Waiting for wallet…" : window.ethereum?.isMetaMask ? "Link MetaMask" : "Link wallet"}
          </Button>
        ) : (
          <p className="mt-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted">
            No wallet found in this browser. Install MetaMask to use this option.
          </p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>
    );

  return (
    <div>
      <div className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3">
        <WalletMark />
        <div className="flex-1">
          <p className="text-sm font-semibold">Linked wallet</p>
          <p className="text-xs text-muted">ending ····{user.wallet.slice(-4)}</p>
        </div>
        <CheckIcon className="h-5 w-5 text-success" />
      </div>
      {/* TODO(FE): approve + fund(dealId) on DealEscrow from the linked wallet once the ABI lands. */}
      <Button size="lg" className="mt-4 w-full" disabled={busy} onClick={onPaid}>
        {busy ? "Confirming in wallet…" : `Pay ${amount} from wallet`}
      </Button>
    </div>
  );
}
