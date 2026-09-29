// Usage guide: the whole flow in plain steps.
import type { ReactNode } from "react";
import { BackBar, Card, Screen, SectionTitle } from "@/components/ui";

const payerSteps: [string, ReactNode][] = [
  ["Start a payment", <>Tap <b>Pay</b> on the home screen (or scan the other person&apos;s QR). Enter their mobile number and check the <b>banking name</b> shown matches who you mean to pay.</>],
  ["Say what you need", "Enter the amount, what it's for, and what should be delivered — deadline, must-haves, quality."],
  ["Agree on the work", <>The other person adds their side. Tap <b>Prepare agreement</b> to turn both sides into one clear list. If you disagree on something like the delivery date, you both enter a date until they match.</>],
  ["Sign", <>Tap <b>Agree &amp; sign</b> and enter your PIN. Your phone signs the exact agreement, so nobody can change it later without it showing.</>],
  ["Pay", "Pay with any UPI app (scan the QR, enter your UPI ID, or open your UPI app on a phone) or the crypto wallet you signed in with. The money is held safely — not sent to the other person yet."],
  ["Release when it's done", <>When the work is delivered, check it and tap <b>Release payment</b>. If you don&apos;t respond within the review window, the other person can claim it.</>],
];

const payeeSteps: [string, ReactNode][] = [
  ["Request money", <>Tap <b>Request</b> on home, or show your <b>QR code</b> so the payer can scan it.</>],
  ["Agree and sign", "Add your terms, agree on the details with the payer, and sign with your PIN."],
  ["Do the work", "Once the payer has paid, you'll see “Paid · held safely”. The money is locked for you until the job is done."],
  ["Mark as delivered", <>Tap <b>Mark as delivered</b> and add a note (for example, where to find the files). The payer then reviews it.</>],
];

const complaintSteps: [string, ReactNode][] = [
  ["Raise a complaint", <>From a payment in progress, tap <b>Raise a complaint</b>. Pick which parts weren&apos;t done, describe the problem, and add photos or videos as proof.</>],
  ["Get a suggested split", "The proof is checked against the signed agreement and a fair split is suggested — for example, 30% back to the payer and 70% to the payee."],
  ["Accept or escalate", <>If you both accept, the money is split that way. If either of you thinks it&apos;s unfair, tap <b>Ask an arbitrator</b>. A human arbitrator reviews everything and makes a final decision.</>],
];

export default function GuidePage() {
  return (
    <>
      <BackBar href="/account" title="How to use Yescro" />
      <Screen className="pt-6">
        <Card className="hero-gradient text-white ring-0">
          <p className="text-lg font-semibold tracking-tight">Pay for work safely</p>
          <p className="mt-1 text-sm text-white/85">
            Yescro holds your money until the work you agreed on is done. Both sides agree on the details first, so there&apos;s
            no confusion later.
          </p>
        </Card>
        <Steps title="If you're paying" steps={payerSteps} />
        <Steps title="If you're getting paid" steps={payeeSteps} />
        <Steps title="If something goes wrong" steps={complaintSteps} />
      </Screen>
    </>
  );
}

function Steps({ title, steps }: { title: string; steps: [string, ReactNode][] }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card>
        <ol>
          {steps.map(([head, body], i) => (
            <li key={head} className="relative flex gap-3.5 pb-5 last:pb-0">
              {i < steps.length - 1 && <span className="absolute left-[13px] top-8 h-[calc(100%-2rem)] w-0.5 bg-line" />}
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-fg">
                {i + 1}
              </span>
              <div>
                <p className="text-[15px] font-semibold tracking-tight">{head}</p>
                <p className="mt-0.5 text-sm text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}
