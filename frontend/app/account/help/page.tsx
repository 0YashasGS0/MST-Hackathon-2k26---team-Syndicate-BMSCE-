"use client";
// Help & support: report a problem. Tickets aren't sent anywhere yet (no support backend).
import Link from "next/link";
import { useState } from "react";
import { CheckIcon, DocIcon, HelpIcon } from "@/components/icons";
import { BackBar, Button, Card, cx, Field, inputCls, Screen, SectionTitle } from "@/components/ui";

const topics = ["A payment", "An agreement", "A complaint", "My account or PIN", "Something else"];

export default function HelpPage() {
  const [topic, setTopic] = useState(topics[0]);
  const [text, setText] = useState("");
  const [ticket, setTicket] = useState<string>();

  return (
    <>
      <BackBar href="/account" title="Help & support" />
      <Screen className="pt-6">
        <div className="grid grid-cols-2 gap-3">
          <Link href="/account/guide" className="rounded-3xl bg-surface p-4 shadow-card ring-1 ring-line/60 transition hover:bg-surface-2">
            <DocIcon className="h-6 w-6 text-accent" />
            <p className="mt-2 text-sm font-semibold">How to use</p>
            <p className="text-xs text-muted">Step-by-step guide</p>
          </Link>
          <Link href="/account/faq" className="rounded-3xl bg-surface p-4 shadow-card ring-1 ring-line/60 transition hover:bg-surface-2">
            <HelpIcon className="h-6 w-6 text-accent" />
            <p className="mt-2 text-sm font-semibold">FAQs</p>
            <p className="text-xs text-muted">Quick answers</p>
          </Link>
        </div>

        <SectionTitle>Report a problem</SectionTitle>
        {ticket ? (
          <Card className="text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-success/10 text-success">
              <CheckIcon className="h-6 w-6" />
            </span>
            <p className="mt-3 font-semibold">We&apos;ve got your request</p>
            <p className="mt-1 text-sm text-muted">
              Ticket <span className="font-mono">{ticket}</span>. We usually reply within 24 hours.
            </p>
            <Button variant="secondary" className="mt-4" onClick={() => (setTicket(undefined), setText(""))}>
              Report something else
            </Button>
          </Card>
        ) : (
          <Card>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                // TODO(backend): POST /support/tickets. Nothing is sent yet.
                setTicket(`SUP${Date.now().toString().slice(-8)}`);
              }}
              className="space-y-4"
            >
              <div>
                <span className="mb-2 block text-[13px] font-medium text-muted">What is it about?</span>
                <div className="flex flex-wrap gap-2">
                  {topics.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTopic(t)}
                      className={cx(
                        "h-9 rounded-full px-3.5 text-sm font-medium transition",
                        topic === t ? "bg-foreground text-background" : "bg-surface-2 text-muted hover:text-foreground",
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <Field label="Tell us what happened">
                <textarea
                  required
                  rows={5}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  className={inputCls}
                  placeholder="Include the transaction ID if it's about a payment."
                />
              </Field>
              <Button size="lg" className="w-full" disabled={text.trim().length < 10}>
                Submit
              </Button>
            </form>
          </Card>
        )}

        <SectionTitle>Stay safe</SectionTitle>
        <Card>
          <ul className="space-y-2 text-sm text-muted">
            <li>• Sakshi will never ask for your PIN or your wallet&apos;s recovery phrase.</li>
            <li>• Always check the banking name before paying.</li>
            <li>• Never pay outside the app for work agreed here — your money is only protected inside Sakshi.</li>
          </ul>
        </Card>
      </Screen>
    </>
  );
}
