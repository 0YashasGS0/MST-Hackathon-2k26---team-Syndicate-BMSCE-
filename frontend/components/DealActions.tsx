"use client";
// What the current party can do next, by on-chain status. Contract calls are stubs until the ABI lands.
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Deal } from "@/lib/types";
import { Button, ButtonLink, Card, Hash } from "./ui";
import { useSession } from "./session";

const notWired = (fn: string) => alert(`${fn} is not wired yet (needs DealEscrow ABI).`);

export function DealActions({ deal }: { deal: Deal }) {
  const { viewAs } = useSession();
  const isBuyer = viewAs === "buyer";
  const base = `/deals/${deal.id}`;

  let body: React.ReactNode;
  switch (deal.status) {
    case "Proposed":
      body = isBuyer ? <Waiting>Waiting for the seller to accept the SOW.</Waiting> : (
        <Button onClick={() => notWired("acceptDeal")}>Accept & sign SOW</Button>
      );
      break;
    case "Accepted":
      body = isBuyer ? <ButtonLink href={`${base}/pay`}>Pay with UPI</ButtonLink> : <Waiting>Waiting for the buyer to fund.</Waiting>;
      break;
    case "Funded":
      body = isBuyer ? <Waiting>Funds are locked. Waiting for delivery.</Waiting> : <DeliverForm dealId={deal.id} />;
      break;
    case "Delivered":
      body = isBuyer ? (
        <div className="space-y-2">
          <ReviewCountdown deal={deal} />
          <Button className="w-full" onClick={() => notWired("release")}>
            Release payment
          </Button>
          <ButtonLink className="w-full" variant="danger" href={`${base}/dispute`}>
            Raise a dispute
          </ButtonLink>
        </div>
      ) : (
        <div className="space-y-2">
          <ReviewCountdown deal={deal} />
          <Button className="w-full" variant="secondary" onClick={() => notWired("claimTimeout")}>
            Claim after timeout
          </Button>
        </div>
      );
      break;
    case "Disputed":
      body = <Waiting>The AI agent is scoring the deliverables…</Waiting>;
      break;
    case "ResolutionProposed":
      body = <ButtonLink className="w-full" href={`${base}/resolution`}>Review the proposed split</ButtonLink>;
      break;
    case "Escalated":
      body = <Waiting>With the human arbitrator.</Waiting>;
      break;
    default:
      body = <Waiting>Deal settled.</Waiting>;
  }

  return (
    <Card title={`Next step · ${viewAs}`}>
      {body}
      {deal.reasoningHash && (
        <ButtonLink className="mt-3 w-full" variant="ghost" href={`${base}/verify`}>
          Verify the AI ruling
        </ButtonLink>
      )}
    </Card>
  );
}

function Waiting({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function ReviewCountdown({ deal }: { deal: Deal }) {
  // Render-time snapshot; a live ticking countdown comes later.
  const [endsAt] = useState(() => (deal.deliveredAt ?? 0) + deal.reviewPeriod);
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const left = endsAt - now;
  const h = Math.max(0, Math.floor(left / 3600));
  const m = Math.max(0, Math.floor((left % 3600) / 60));
  return (
    <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm">
      {left > 0 ? (
        <>
          Review window ends in <b>{h}h {m}m</b>
        </>
      ) : (
        "Review window has ended"
      )}
    </p>
  );
}

function DeliverForm({ dealId }: { dealId: string }) {
  const file = useRef<HTMLInputElement>(null);
  const [hash, setHash] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function upload() {
    const f = file.current?.files?.[0];
    if (!f) return;
    setBusy(true);
    const form = new FormData();
    form.set("file", f);
    const r = await api.uploadDelivery(dealId, form);
    setHash(r.hash);
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <input ref={file} type="file" className="text-sm" />
      {!hash ? (
        <Button className="w-full" disabled={busy} onClick={upload}>
          {busy ? "Uploading…" : "Upload delivery"}
        </Button>
      ) : (
        <>
          <p className="text-xs text-muted">
            File hash: <Hash value={hash} />
          </p>
          <Button className="w-full" onClick={() => notWired("markDelivered")}>
            Sign markDelivered
          </Button>
        </>
      )}
    </div>
  );
}
