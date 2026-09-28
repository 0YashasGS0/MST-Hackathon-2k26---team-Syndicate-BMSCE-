import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { fmtUsd } from "@/lib/format";
import { AddressLink, Card, Hash, PageHeader, Stat, StatusChip } from "@/components/ui";
import { Timeline } from "@/components/Timeline";
import { DealActions } from "@/components/DealActions";
import { ViewAsToggle } from "@/components/ViewAsToggle";
import { ESCROW_ADDRESS } from "@/lib/contracts";

export default async function DealPage(props: PageProps<"/deals/[id]">) {
  const { id } = await props.params;
  const deal = await api.getDeal(id).catch(() => notFound());
  const inEscrow = ["Funded", "Delivered", "Disputed", "ResolutionProposed", "Escalated"].includes(deal.status);

  return (
    <div>
      <PageHeader
        title={deal.title}
        subtitle={
          <span className="inline-flex items-center gap-2">
            Deal #{deal.id} <StatusChip status={deal.status} />
          </span>
        }
        actions={<ViewAsToggle />}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <div className="grid gap-6 sm:grid-cols-3">
              <Stat
                label="In escrow"
                value={`${inEscrow ? fmtUsd(deal.amount) : "0"} mUSD`}
                sub={ESCROW_ADDRESS ? <AddressLink address={ESCROW_ADDRESS} /> : "held by the escrow contract"}
              />
              <Stat label="Deal value" value={`${fmtUsd(deal.amount)} mUSD`} />
              <Stat label="Deliver by" value={new Date(deal.deliverBy * 1000).toLocaleDateString()} />
            </div>
          </Card>

          <Card title="On-chain timeline">
            <Timeline events={deal.events} />
          </Card>
        </div>

        <div className="space-y-4">
          <DealActions deal={deal} />

          <Card title="Parties & commitments">
            <dl className="space-y-3 text-sm">
              <Row k="Buyer" v={<AddressLink address={deal.buyer} />} />
              <Row k="Seller" v={<AddressLink address={deal.seller} />} />
              <Row k="SOW hash" v={<Hash value={deal.sowHash} />} />
              {deal.deliveryHash && <Row k="Delivery hash" v={<Hash value={deal.deliveryHash} />} />}
              {deal.evidenceHash && <Row k="Evidence hash" v={<Hash value={deal.evidenceHash} />} />}
              {deal.reasoningHash && <Row k="AI reasoning hash" v={<Hash value={deal.reasoningHash} />} />}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
