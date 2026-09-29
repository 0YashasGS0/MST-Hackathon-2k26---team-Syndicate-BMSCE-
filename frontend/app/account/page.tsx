"use client";
// Account: profile, my QR, security (device + PIN), help, usage guide, FAQs, log out.
import { useState, type ReactNode } from "react";
import { fmtDate, fmtDateTime, maskPhone } from "@/lib/format";
import { useSession, useUser } from "@/components/session";
import { AlertIcon, CheckIcon, DocIcon, HelpIcon, LockIcon, PhoneIcon, QrIcon, WalletIcon } from "@/components/icons";
import { Avatar, BackBar, Card, ListRow, Screen, SectionTitle } from "@/components/ui";

export default function AccountPage() {
  const user = useUser();
  const { signOut } = useSession();
  const name = user.name ?? "My account";
  const [nowSecs] = useState(() => Math.floor(Date.now() / 1000));
  const cooling = user.coolingUntil && user.coolingUntil > nowSecs ? user.coolingUntil : undefined;

  return (
    <>
      <BackBar href="/home" title="Account" />
      <Screen className="pt-6">
        <Card className="flex items-center gap-4">
          <Avatar name={name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold tracking-tight">{name}</p>
            <p className="text-sm text-muted">{maskPhone(user.phone)}</p>
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
              <CheckIcon className="h-3.5 w-3.5" /> KYC verified
            </span>
          </div>
        </Card>

        <Card flush className="mt-4">
          <ListRow
            href="/qr"
            leading={<Tile><QrIcon className="h-5 w-5" /></Tile>}
            title="My QR code"
            subtitle="Get paid or request money by showing your code"
          />
        </Card>

        <SectionTitle>Security</SectionTitle>
        <Card flush className="divide-y divide-line/70">
          <Item icon={<PhoneIcon className="h-5 w-5" />} title="This device is registered">
            {user.deviceBoundAt ? `Since ${fmtDate(user.deviceBoundAt)}. ` : ""}Only one device can use your account at a time.
          </Item>
          <Item icon={<LockIcon className="h-5 w-5" />} title="Security PIN is on">
            Asked when you open the app, sign an agreement, release money, or move to a new device.
          </Item>
          {cooling && (
            <Item icon={<AlertIcon className="h-5 w-5" />} title="New device cooling period" tone="warning">
              Payments above ₹5,000 are paused until {fmtDateTime(cooling)}.
            </Item>
          )}
          <Item icon={<WalletIcon className="h-5 w-5" />} title="Signed in with your wallet">
            Ending ····{user.address.slice(-4)}. Switching accounts in your wallet signs you out here.
          </Item>
        </Card>

        <SectionTitle>Help</SectionTitle>
        <Card flush className="divide-y divide-line/70">
          <ListRow href="/account/guide" leading={<Tile><DocIcon className="h-5 w-5" /></Tile>} title="How to use Yescro" subtitle="Step-by-step guide" />
          <ListRow href="/account/faq" leading={<Tile><HelpIcon className="h-5 w-5" /></Tile>} title="FAQs" subtitle="Common questions answered" />
          <ListRow href="/account/help" leading={<Tile><AlertIcon className="h-5 w-5" /></Tile>} title="Help & support" subtitle="Report a problem or contact us" />
        </Card>

        <button
          onClick={() => signOut()}
          className="mt-8 w-full rounded-full bg-danger/10 py-3.5 text-sm font-semibold text-danger transition hover:bg-danger/15"
        >
          Log out of this device
        </button>
        <p className="mt-3 text-center text-xs text-muted">Logging back in on this device needs your wallet.</p>
      </Screen>
    </>
  );
}

function Tile({ children }: { children: ReactNode }) {
  return <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent">{children}</span>;
}

function Item({ icon, title, children, tone }: { icon: ReactNode; title: string; children: ReactNode; tone?: "warning" }) {
  return (
    <div className="flex items-start gap-3.5 px-4 py-3.5 sm:px-5">
      <span
        className={
          tone === "warning"
            ? "grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-warning/10 text-warning"
            : "grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent-soft text-accent"
        }
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold tracking-tight">{title}</p>
        <p className="text-[13px] text-muted">{children}</p>
      </div>
    </div>
  );
}
