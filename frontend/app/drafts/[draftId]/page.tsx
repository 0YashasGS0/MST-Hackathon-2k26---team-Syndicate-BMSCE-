"use client";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useSession, type Party } from "@/components/session";
import { api } from "@/lib/api";
import { fmtBps, fmtUsd } from "@/lib/format";
import type { ApproveSowResult, Draft, SowVersion } from "@/lib/types";
import { Badge, Button, Card, Field, Hash, inputCls, MockNote, PageHeader } from "@/components/ui";
import { ViewAsToggle } from "@/components/ViewAsToggle";

export default function SowWorkspace() {
  const { draftId } = useParams<{ draftId: string }>();
  const { viewAs } = useSession();
  const [draft, setDraft] = useState<Draft>();
  const [sow, setSow] = useState<SowVersion | null>(null);
  const [approval, setApproval] = useState<ApproveSowResult>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api.getDraft(draftId).then(setDraft, (e) => setError(String(e)));
    api.getSow(draftId).then(setSow);
  }, [draftId]);

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(undefined);
    }
  }

  if (error && !draft) return <p className="text-danger">{error}</p>;
  if (!draft) return <p className="text-muted">Loading…</p>;

  return (
    <div>
      <PageHeader
        title={draft.purpose}
        subtitle={<>Statement of work · {fmtUsd(draft.price)} mUSD</>}
        actions={<ViewAsToggle />}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Buyer's requirements">
          <p className="whitespace-pre-wrap text-sm">{draft.buyerConstraints}</p>
        </Card>
        <Card title="Seller's points">
          {draft.sellerPoints ? (
            <p className="whitespace-pre-wrap text-sm">{draft.sellerPoints}</p>
          ) : viewAs === "seller" ? (
            <SellerInput busy={!!busy} onSubmit={(p) => run("seller", () => api.sellerInput(draftId, p).then(setDraft))} />
          ) : (
            <p className="text-sm text-muted">Waiting for the seller…</p>
          )}
        </Card>
      </div>

      <Card
        className="mt-4"
        title={sow ? `Merged SOW · v${sow.version}` : "Merged SOW"}
        actions={
          <Button
            variant={sow ? "secondary" : "primary"}
            disabled={!draft.sellerPoints || !!busy}
            onClick={() => run("merge", () => api.mergeSow(draftId).then((v) => (setSow(v), setApproval(undefined))))}
          >
            {busy === "merge" ? "AI is merging…" : sow ? "Re-merge" : "Merge with AI"}
          </Button>
        }
      >
        {!sow ? (
          <p className="text-sm text-muted">Once both sides have written their points, merge them into a weighted SOW.</p>
        ) : (
          <SowView sow={sow} />
        )}
      </Card>

      {sow && (
        <Card className="mt-4" title="Approve & commit on-chain">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <ApprovalPill who="Buyer" ok={sow.buyerApproved} />
            <ApprovalPill who="Seller" ok={sow.sellerApproved} />
            <span className="text-muted">
              SOW hash <Hash value={sow.sowHash} />
            </span>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={!!busy || (viewAs === "buyer" ? sow.buyerApproved : sow.sellerApproved)}
              onClick={() =>
                run("approve", async () => {
                  const r = await api.approveSow(draftId, viewAs, sow.version);
                  setSow({ ...sow, [viewAs === "buyer" ? "buyerApproved" : "sellerApproved"]: true });
                  setApproval(r);
                })
              }
            >
              Approve as {viewAs}
            </Button>
            {approval?.bothApproved && <SignStep party={viewAs} />}
          </div>
          <MockNote>
            before signing, the browser recomputes the SOW hash with <code>shared/hash.ts</code> and refuses to sign on a mismatch.
            Not wired yet.
          </MockNote>
        </Card>
      )}

      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
    </div>
  );
}

function SellerInput({ busy, onSubmit }: { busy: boolean; onSubmit: (p: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div className="space-y-3">
      <Field label="Your scope, exclusions and timeline">
        <textarea rows={4} className={inputCls} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Button disabled={busy || !text.trim()} onClick={() => onSubmit(text)}>
        Submit points
      </Button>
    </div>
  );
}

function SowView({ sow }: { sow: SowVersion }) {
  return (
    <div className="space-y-4">
      {sow.conflicts.length > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
          <p className="font-medium text-warning">Conflicts to resolve before approving</p>
          <ul className="mt-2 space-y-1">
            {sow.conflicts.map((c) => (
              <li key={c.field}>
                <b>{c.field}</b>: buyer wants {c.buyer}, seller says {c.seller}
                {c.note && <span className="text-muted"> — {c.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-muted">
            <tr>
              <th className="py-2 pr-3">ID</th>
              <th className="py-2 pr-3">Deliverable</th>
              <th className="py-2 pr-3">Acceptance criteria</th>
              <th className="py-2 text-right">Weight</th>
            </tr>
          </thead>
          <tbody>
            {sow.sow.deliverables.map((d) => (
              <tr key={d.id} className="border-t border-line align-top">
                <td className="py-3 pr-3 font-mono text-xs">{d.id}</td>
                <td className="py-3 pr-3">
                  <div className="font-medium">{d.title}</div>
                  <div className="text-muted">{d.description}</div>
                </td>
                <td className="py-3 pr-3">
                  <ul className="list-disc pl-4">
                    {d.acceptanceCriteria.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </td>
                <td className="py-3 text-right">
                  <div className="font-medium">{fmtBps(d.weightBps)}</div>
                  <div className="ml-auto mt-1 h-1.5 w-20 rounded bg-surface-2">
                    <div className="h-full rounded bg-accent" style={{ width: `${d.weightBps / 100}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted">
        Deliver by {new Date(sow.sow.deliveryDeadline * 1000).toLocaleDateString()} · review window{" "}
        {Math.round(sow.sow.reviewWindowSecs / 3600)} h
      </p>
    </div>
  );
}

function ApprovalPill({ who, ok }: { who: string; ok: boolean }) {
  return <Badge tone={ok ? "success" : "neutral"}>{ok ? `✓ ${who} approved` : `${who} pending`}</Badge>;
}

function SignStep({ party }: { party: Party }) {
  // TODO(FE): wire proposeDeal / acceptDeal with viem once the ABI lands.
  return (
    <Button variant="secondary" onClick={() => alert("Signing is not wired yet (needs ABI).")}>
      {party === "buyer" ? "Sign proposeDeal in wallet" : "Sign acceptDeal in wallet"}
    </Button>
  );
}
