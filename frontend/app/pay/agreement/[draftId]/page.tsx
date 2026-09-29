"use client";
// Both sides' terms → drafted agreement → any disagreement resolved by both parties (never a silent
// middle ground) → each party signs the agreement with their device key → deal is created.
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { sowHash, verifySignature } from "@/lib/agreement";
import { signHash } from "@/lib/device-key";
import { fmtDate, fmtDateTime, fmtInr } from "@/lib/format";
import type { Conflict, Draft, Party, SowVersion } from "@/lib/types";
import { useUser } from "@/components/session";
import { SowList } from "@/components/SowList";
import { PinSheet } from "@/components/Pin";
import { AlertIcon, CheckIcon, LockIcon, PenIcon } from "@/components/icons";
import { Avatar, BackBar, Button, ButtonLink, Card, cx, inputCls, Loading, Screen, SectionTitle } from "@/components/ui";

export default function AgreementPage() {
  const { draftId } = useParams<{ draftId: string }>();
  const router = useRouter();
  const user = useUser();
  const [draft, setDraft] = useState<Draft>();
  const [sow, setSow] = useState<SowVersion | null>(null);
  const [verified, setVerified] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [askPin, setAskPin] = useState(false);
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showRedo, setShowRedo] = useState(false);
  const [redoText, setRedoText] = useState("");

  const load = useCallback(
    () =>
      Promise.all([api.getDraft(draftId), api.getSow(draftId)]).then(
        ([d, v]) => {
          setDraft(d);
          setSow(v);
        },
        (e) => setError(e instanceof Error ? e.message : String(e)),
      ),
    [draftId],
  );

  // Keep in sync with the other party's actions.
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  // Check every stored signature against the agreement text on this device.
  useEffect(() => {
    if (!sow) return;
    Promise.all(sow.signatures.map(async (s) => [s.party, await verifySignature(sow.sow, s)] as const)).then((r) =>
      setVerified(Object.fromEntries(r)),
    );
  }, [sow]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(undefined);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  if (!draft)
    return (
      <>
        <BackBar href="/home" title="Agreement" />
        {error ? <p className="p-6 text-center text-danger">{error}</p> : <Loading />}
      </>
    );

  const me: Party = draft.buyer.toLowerCase() === user.address.toLowerCase() ? "buyer" : "seller";
  const them: Party = me === "buyer" ? "seller" : "buyer";
  const other = me === "buyer" ? draft.sellerName : draft.buyerName;
  const otherFirst = (other || "").split(" ")[0];
  const myTerms = me === "buyer" ? draft.buyerTerms : draft.sellerTerms;
  const theirTerms = me === "buyer" ? draft.sellerTerms : draft.buyerTerms;
  const mySig = sow?.signatures.find((s) => s.party === me);
  const locked = !!draft.dealId;
  const isCancelled = draft.status === "cancelled";
  const cancelledByMe = draft.cancelledBy === me;

  /** PIN confirms it's you; the device key produces the signature over the agreement's fingerprint. */
  async function sign(pin: string) {
    if (!sow) return;
    if (sowHash(sow.sow) !== sow.sowHash) throw new Error("This agreement doesn't match its fingerprint. Not signing.");
    const signature = await signHash(sow.sowHash);
    await api.signSow(draftId, me, sow.version, signature, pin);
    setAskPin(false);
    const d = await api.getDraft(draftId);
    if (d.dealId) return router.push(`/txn/${d.dealId}`);
    await load();
  }

  async function handleCancel() {
    if (!cancelReason.trim()) return;
    await run("cancel", () => api.cancelDraft(draftId, me, cancelReason.trim()));
    setShowCancel(false);
    setCancelReason("");
  }

  async function handleRedo() {
    if (!redoText.trim() || redoText.trim().length < 5) return;
    await run("redo", () => api.redoTerms(draftId, me, redoText.trim()));
    setShowRedo(false);
    setRedoText("");
  }

  // ---- Cancelled state ----
  if (isCancelled) {
    return (
      <>
        <BackBar href="/home" title="Agreement" />
        <Screen className="pt-6">
          <div className="flex flex-col items-center text-center">
            <div className="grid h-20 w-20 place-items-center rounded-full bg-danger/10 text-danger">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="mt-4 text-lg font-semibold">Agreement Rejected</p>
            <p className="mt-1 text-sm text-muted">
              {cancelledByMe ? "You" : otherFirst} rejected this agreement
            </p>
          </div>

          <Card className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Reason</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{draft.cancelReason}</p>
          </Card>

          <Card className="mt-3">
            <p className="text-sm text-muted">
              <span className="font-semibold text-foreground">{draft.purpose}</span> · {fmtInr(draft.price)} with {other}
            </p>
          </Card>

          {!cancelledByMe && (
            <div className="mt-6 flex flex-col gap-2">
              <Button
                size="lg"
                className="w-full"
                onClick={() => {
                  setRedoText(myTerms || "");
                  setShowRedo(true);
                }}
              >
                ✏️ Propose new terms &amp; redo
              </Button>
              <ButtonLink size="lg" variant="secondary" className="w-full" href="/home">
                Go back
              </ButtonLink>
            </div>
          )}
          {cancelledByMe && (
            <ButtonLink size="lg" variant="secondary" className="mx-auto mt-6 w-full max-w-sm" href="/home">
              Go back to home
            </ButtonLink>
          )}

          {/* Redo terms sheet */}
          {showRedo && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
              <div className="w-full max-w-md rounded-t-3xl bg-surface p-6 sm:rounded-3xl">
                <p className="text-lg font-semibold">Update your terms</p>
                <p className="mt-1 text-sm text-muted">
                  Edit your terms below. A new agreement will be generated for both parties.
                </p>
                <textarea
                  rows={5}
                  value={redoText}
                  onChange={(e) => setRedoText(e.target.value)}
                  className={cx(inputCls, "mt-4")}
                  placeholder="What you need, timeline, conditions..."
                />
                <div className="mt-4 flex gap-2">
                  <Button variant="secondary" className="flex-1" onClick={() => setShowRedo(false)}>
                    Cancel
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={busy === "redo" || redoText.trim().length < 5}
                    onClick={handleRedo}
                  >
                    {busy === "redo" ? "Sending…" : "Submit & redo"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Screen>
      </>
    );
  }

  return (
    <>
      <BackBar href="/home" title="Agreement" />
      <Screen className="pt-6">
        <div className="flex flex-col items-center text-center">
          <Avatar name={other} size="lg" />
          <p className="mt-3 text-sm text-muted">{me === "buyer" ? `You pay ${other}` : `${other} pays you`}</p>
          <p className="num mt-1 text-4xl font-semibold">{fmtInr(draft.price)}</p>
          <p className="mt-1 text-sm text-muted">{draft.purpose}</p>
        </div>

        {/* 1. both sides of the story */}
        <SectionTitle>What each side said</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">You</p>
            {myTerms ? (
              <p className="mt-2 whitespace-pre-wrap text-sm">{myTerms}</p>
            ) : (
              <TermsInput
                role={me}
                busy={busy === "terms"}
                onSubmit={(t) => run("terms", () => api.addTerms(draftId, me, t))}
              />
            )}
          </Card>
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">{other}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {theirTerms ?? <span className="text-muted">Waiting for {otherFirst} to add their terms…</span>}
            </p>
          </Card>
        </div>

        {/* 2. the agreement */}
        {myTerms && theirTerms && (
          <>
            <SectionTitle>Agreement</SectionTitle>
            {!sow ? (
              <Card className="text-center">
                <p className="text-sm text-muted">We&apos;ll turn both sides into one clear list of what gets delivered.</p>
                <Button className="mt-4" onClick={() => run("merge", () => api.mergeSow(draftId))} disabled={!!busy}>
                  {busy === "merge" ? "Preparing agreement…" : "Prepare agreement"}
                </Button>
              </Card>
            ) : (
              <>
                {sow.conflicts.map((c) => (
                  <ConflictCard
                    key={c.field}
                    conflict={c}
                    me={me}
                    otherFirst={otherFirst}
                    busy={busy === c.field}
                    onPropose={(value) => run(c.field, () => api.proposeConflict(draftId, me, c.field, value))}
                  />
                ))}
                <Card>
                  <SowList sow={sow.sow} />
                </Card>

                {/* 3. signatures */}
                <SectionTitle>Signatures</SectionTitle>
                <Card flush className="divide-y divide-line/70">
                  <SigRow name="You" signedAt={mySig?.signedAt} ok={verified[me]} />
                  <SigRow name={other} signedAt={sow.signatures.find((s) => s.party === them)?.signedAt} ok={verified[them]} />
                </Card>
                <p className="mt-3 flex items-start gap-2 px-1 text-xs text-muted">
                  <LockIcon className="mt-0.5 h-4 w-4 shrink-0" />
                  Signing creates a digital signature from this device over the exact agreement above. Any later change to
                  the agreement would break both signatures, so it can&apos;t be altered without you knowing.
                </p>
                <Button variant="ghost" size="sm" className="mt-4 w-full border border-line" onClick={() => window.print()}>
                  Download Draft Contract (PDF)
                </Button>

                <div className="mt-5">
                  {locked ? (
                    <ButtonLink size="lg" className="w-full" href={`/txn/${draft.dealId}`}>
                      View transaction
                    </ButtonLink>
                  ) : mySig ? (
                    <p className="rounded-2xl bg-accent-soft px-4 py-3 text-center text-sm font-medium text-accent">
                      You&apos;ve signed. Waiting for {otherFirst} to sign.
                    </p>
                  ) : (
                    <Button
                      size="lg"
                      className="w-full"
                      disabled={!!busy || sow.conflicts.length > 0}
                      onClick={() => setAskPin(true)}
                    >
                      <PenIcon className="h-5 w-5" />
                      {sow.conflicts.length ? "Resolve the open points to sign" : "Agree & sign"}
                    </Button>
                  )}
                </div>

                {/* Redo & Cancel — only before signing */}
                {!locked && !mySig && (
                  <div className="mt-3 flex flex-col gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full border border-line"
                      onClick={() => {
                        setRedoText(myTerms || "");
                        setShowRedo(true);
                      }}
                      disabled={!!busy}
                    >
                      ✏️ Change my terms &amp; redo agreement
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full border border-danger/30 text-danger hover:bg-danger/10"
                      onClick={() => setShowCancel(true)}
                      disabled={!!busy}
                    >
                      ✕ Reject this agreement
                    </Button>
                  </div>
                )}
              </>
            )}
          </>
        )}
        {error && <p className="mt-4 text-center text-sm text-danger">{error}</p>}
      </Screen>

      {/* PIN sheet for signing */}
      {askPin && (
        <PinSheet
          title="Sign the agreement"
          subtitle={`You're agreeing to ${fmtInr(draft.price)} for "${draft.purpose}" with ${other}`}
          onSubmit={sign}
          onClose={() => setAskPin(false)}
        />
      )}

      {/* Cancel / Reject sheet */}
      {showCancel && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-surface p-6 sm:rounded-3xl">
            <p className="text-lg font-semibold text-danger">Reject this agreement</p>
            <p className="mt-1 text-sm text-muted">
              Tell {otherFirst} why you&apos;re rejecting. They can propose new terms or walk away.
            </p>
            <textarea
              rows={4}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className={cx(inputCls, "mt-4")}
              placeholder="Why are you rejecting? e.g. Price is too high, timeline doesn't work..."
            />
            <div className="mt-4 flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => { setShowCancel(false); setCancelReason(""); }}
              >
                Go back
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                disabled={busy === "cancel" || cancelReason.trim().length < 3}
                onClick={handleCancel}
              >
                {busy === "cancel" ? "Rejecting…" : "Reject agreement"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Redo terms sheet */}
      {showRedo && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center">
          <div className="w-full max-w-md rounded-t-3xl bg-surface p-6 sm:rounded-3xl">
            <p className="text-lg font-semibold">Update your terms</p>
            <p className="mt-1 text-sm text-muted">
              Edit your terms below. The agreement will be regenerated from scratch.
            </p>
            <textarea
              rows={5}
              value={redoText}
              onChange={(e) => setRedoText(e.target.value)}
              className={cx(inputCls, "mt-4")}
              placeholder="What you need, timeline, conditions..."
            />
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setShowRedo(false)}>
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={busy === "redo" || redoText.trim().length < 5}
                onClick={handleRedo}
              >
                {busy === "redo" ? "Sending…" : "Submit & redo"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TermsInput({ role, busy, onSubmit }: { role: Party; busy: boolean; onSubmit: (t: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="mt-2 space-y-3">
      <textarea
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={inputCls}
        placeholder={
          role === "seller"
            ? "What you'll deliver, timeline, what's not included. e.g. Two pages, 8 days, printing not included."
            : "What you need, deadline, must-haves. e.g. Print-ready, within 5 days, include our logo."
        }
      />
      <Button className="w-full" disabled={busy || text.trim().length < 5} onClick={() => onSubmit(text.trim())}>
        {busy ? "Saving…" : "Add my terms"}
      </Button>
    </div>
  );
}

const toInput = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
const fromInput = (s: string) => Math.floor(new Date(`${s}T00:00:00Z`).getTime() / 1000);

function ConflictCard({
  conflict: c,
  me,
  otherFirst,
  busy,
  onPropose,
}: {
  conflict: Conflict;
  me: Party;
  otherFirst: string;
  busy: boolean;
  onPropose: (v: number) => void;
}) {
  const them: Party = me === "buyer" ? "seller" : "buyer";
  const myAsk = me === "buyer" ? c.buyerWants : c.sellerWants;
  const theirAsk = me === "buyer" ? c.sellerWants : c.buyerWants;
  const mine = c.proposals[me];
  const theirs = c.proposals[them];
  const [value, setValue] = useState(toInput(mine ?? theirs ?? myAsk));
  const [today] = useState(() => toInput(Math.floor(Date.now() / 1000)));

  return (
    <Card className="mb-3 ring-warning/40">
      <div className="flex items-center gap-2 text-warning">
        <AlertIcon className="h-5 w-5" />
        <p className="text-sm font-semibold">You disagree on the {c.label.toLowerCase()}</p>
      </div>
      <p className="mt-1 text-sm text-muted">
        We won&apos;t pick a middle ground for you. Both of you need to enter the same date before the agreement can be
        signed.
      </p>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-xs text-muted">You asked for</dt>
          <dd className="font-semibold">{fmtDate(myAsk)}</dd>
        </div>
        <div className="rounded-2xl bg-surface-2 p-3">
          <dt className="text-xs text-muted">{otherFirst} asked for</dt>
          <dd className="font-semibold">{fmtDate(theirAsk)}</dd>
        </div>
      </dl>

      {theirs !== undefined && theirs !== mine && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-accent-soft p-3 text-sm">
          <span>
            {otherFirst} proposed <b>{fmtDate(theirs)}</b>
          </span>
          <Button size="sm" disabled={busy} onClick={() => onPropose(theirs)}>
            Accept {fmtDate(theirs)}
          </Button>
        </div>
      )}
      {mine !== undefined && theirs !== mine && (
        <p className="mt-3 text-sm text-muted">
          You proposed <b className="text-foreground">{fmtDate(mine)}</b>. Waiting for {otherFirst} to accept or suggest another date.
        </p>
      )}

      <div className="mt-4 flex gap-2">
        <input
          type="date"
          value={value}
          min={today}
          onChange={(e) => setValue(e.target.value)}
          className={cx(inputCls, "flex-1")}
          aria-label={`Propose a ${c.label.toLowerCase()}`}
        />
        <Button variant="secondary" disabled={busy || !value} onClick={() => onPropose(fromInput(value))}>
          {busy ? "Sending…" : mine === undefined ? "Propose" : "Change"}
        </Button>
      </div>
    </Card>
  );
}

function SigRow({ name, signedAt, ok }: { name: string; signedAt?: number; ok?: boolean }) {
  return (
    <div className="flex items-center gap-3.5 px-5 py-4 sm:px-6">
      <span
        className={cx(
          "grid h-10 w-10 shrink-0 place-items-center rounded-2xl",
          signedAt ? "bg-success/10 text-success" : "bg-surface-2 text-muted",
        )}
      >
        {signedAt ? <CheckIcon className="h-5 w-5" /> : <PenIcon className="h-5 w-5" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold">{name}</p>
        <p className="text-[13px] text-muted">{signedAt ? `Signed ${fmtDateTime(signedAt)}` : "Not signed yet"}</p>
      </div>
      {signedAt && (
        <span className={cx("text-xs font-semibold", ok === false ? "text-danger" : "text-success")}>
          {ok === undefined ? "Checking…" : ok ? "Verified" : "Invalid"}
        </span>
      )}
    </div>
  );
}
