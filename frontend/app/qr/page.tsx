"use client";
// Personal QR. Whoever scans it lands on Pay / Request with you already selected and the right mode set.
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { maskPhone } from "@/lib/format";
import { useUser } from "@/components/session";
import { ScanIcon, UploadIcon } from "@/components/icons";
import { Avatar, BackBar, ButtonLink, Card, cx, Screen } from "@/components/ui";

type Mode = "receive" | "pay";

export default function QrPage() {
  const user = useUser();
  const [mode, setMode] = useState<Mode>("receive");
  const [src, setSrc] = useState<string>();
  const name = user.name ?? "Me";

  useEffect(() => {
    // The scanner's role is the opposite of mine: if I'm receiving, they pay.
    const url = `${window.location.origin}/pay/new?to=${user.phone}&role=${mode === "receive" ? "buyer" : "seller"}`;
    QRCode.toDataURL(url, { width: 560, margin: 1, errorCorrectionLevel: "M", color: { dark: "#0f1a16", light: "#ffffff" } }).then(setSrc);
  }, [mode, user.phone]);

  return (
    <>
      <BackBar href="/home" title="My QR code" />
      <Screen className="pt-5">
        <div role="radiogroup" aria-label="QR mode" className="grid grid-cols-2 rounded-full bg-surface-2 p-1 ring-1 ring-line/60">
          {(
            [
              ["receive", "Get paid"],
              ["pay", "Pay someone"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              onClick={() => setMode(value)}
              className={cx(
                "h-10 rounded-full text-sm font-semibold transition",
                mode === value ? "bg-surface text-foreground shadow-card ring-1 ring-line/60" : "text-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Card className="mt-5 text-center">
          <div className="flex flex-col items-center">
            <Avatar name={name} size="lg" />
            <p className="mt-3 text-lg font-semibold tracking-tight">{name}</p>
            <p className="text-sm text-muted">{maskPhone(user.phone)}</p>
          </div>
          <div className="mx-auto mt-5 w-full max-w-[280px] rounded-3xl bg-white p-4 ring-1 ring-line">
            {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL */}
            {src ? <img src={src} alt="Your QR code" className="aspect-square w-full" /> : <div className="aspect-square w-full" />}
          </div>
          <p className="mx-auto mt-4 max-w-xs text-sm text-muted">
            {mode === "receive"
              ? "Show this to the person paying you. Scanning it opens a payment to you."
              : "Show this to the person you're paying. Scanning it opens a payment request from them to you."}
          </p>
        </Card>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <ButtonLink size="lg" variant="secondary" href="/qr/scan">
            <ScanIcon className="h-5 w-5" />
            Scan QR
          </ButtonLink>
          <ButtonLink size="lg" variant="secondary" href="/qr/scan#upload">
            <UploadIcon className="h-5 w-5" />
            Upload QR
          </ButtonLink>
        </div>
      </Screen>
    </>
  );
}
