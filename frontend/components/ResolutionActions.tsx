"use client";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, Card } from "./ui";
import { useSession } from "./session";

export function ResolutionActions({ dealId }: { dealId: string }) {
  const { viewAs } = useSession();
  // TODO(FE): read each party's acceptance from getDeal; wire acceptResolution / escalate.
  const [accepted, setAccepted] = useState({ buyer: false, seller: false });

  return (
    <Card title="Your decision">
      <div className="mb-4 flex gap-2">
        <Badge tone={accepted.buyer ? "success" : "neutral"}>Buyer {accepted.buyer ? "accepted" : "pending"}</Badge>
        <Badge tone={accepted.seller ? "success" : "neutral"}>Seller {accepted.seller ? "accepted" : "pending"}</Badge>
      </div>
      <div className="space-y-2">
        <Button className="w-full" disabled={accepted[viewAs]} onClick={() => setAccepted({ ...accepted, [viewAs]: true })}>
          Accept split (as {viewAs})
        </Button>
        <Button className="w-full" variant="danger" onClick={() => alert("escalate is not wired yet (needs ABI).")}>
          Escalate to arbitrator
        </Button>
      </div>
      <Link href={`/deals/${dealId}/verify`} className="mt-4 block text-center text-sm text-accent hover:underline">
        Verify this ruling yourself →
      </Link>
    </Card>
  );
}
