// B1: the ONE Deal shape every deal endpoint returns (frontend/lib/types.ts `Deal`). On-chain getDeal is the source of
// truth for parties, money, status and hashes; SQLite adds the title (B2's linked SOW), names, notes, the ruling
// text and the event timeline.
import type { AnyReasoning } from "@kernel-exploits/shared";
import { escrowAbi, ESCROW, pub } from "./chain.js";
import { db } from "./db.js";
import { accounts } from "./accountsStore.js";
import { sowStore } from "./sowStore.js";

/** DealEscrow.Status, in contract order. */
export const DEAL_STATUS = [
  "None", "Proposed", "Accepted", "Funded", "Delivered", "Disputed",
  "ResolutionProposed", "Escalated", "Released", "Refunded", "Resolved", "Cancelled",
] as const;
export type DealStatusName = (typeof DEAL_STATUS)[number];
const status = (n: number): DealStatusName => DEAL_STATUS[n] ?? "None";

export type OnchainDeal = {
  buyer: string;
  seller: string;
  amount: bigint;
  sowHash: string;
  deliveryHash: string;
  evidenceHash: string;
  reasoningHash: string;
  deliverBy: bigint;
  reviewPeriod: bigint;
  deliveredAt: bigint;
  proposedBuyerBps: number;
  buyerAccepted: boolean;
  sellerAccepted: boolean;
  status: number;
};

export type DealView = {
  id: string;
  draftId: string;
  title: string;
  buyer: string;
  seller: string;
  buyerName: string;
  sellerName: string;
  amount: string;
  status: Exclude<DealStatusName, "None">;
  sowHash: string;
  deliverBy: number;
  reviewPeriod: number;
  deliveredAt?: number;
  deliveryNote?: string;
  buyerBps?: number;
  accepted?: { buyer: boolean; seller: boolean };
  ruledBy?: "ai" | "arbitrator";
  arbitratorNote?: string;
  paidWith?: string;
  events: { name: string; txHash: string; logIndex: number; block: number; timestamp: number; args: Record<string, string> }[];
};

export class ChainUnavailableError extends Error {}

export async function readOnchainDeal(id: number): Promise<OnchainDeal | null> {
  if (!ESCROW) throw new ChainUnavailableError("chain not configured yet");
  let d: OnchainDeal;
  try {
    d = (await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getDeal", args: [BigInt(id)] })) as OnchainDeal;
  } catch (err) {
    throw new ChainUnavailableError(err instanceof Error ? err.message : String(err));
  }
  return Number(d.status) === 0 ? null : d;
}

const hasTable = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);

export function latestRuling(dealId: number): AnyReasoning | undefined {
  return sowStore.getRulingsForDeal(dealId)[0]?.reasoning;
}

export function toDealView(id: number, d: OnchainDeal): DealView {
  const s = status(Number(d.status));
  const linked = sowStore.getSowForDeal(id);
  const note = db.prepare("SELECT note FROM deal_notes WHERE deal_id = ? AND kind = 'delivery'").get(id) as { note: string } | undefined;
  const ruling = latestRuling(id);
  const paid = hasTable("payments")
    ? (db.prepare("SELECT method FROM payments WHERE deal_id = ?").get(id) as { method: string | null } | undefined)
    : undefined;
  const events = (db
    .prepare("SELECT tx_hash, log_index, name, args_json, block FROM chain_events WHERE deal_id = ? ORDER BY block ASC, log_index ASC")
    .all(id) as { tx_hash: string; log_index: number; name: string; args_json: string; block: number }[]).map((e) => ({
    name: e.name,
    txHash: e.tx_hash,
    logIndex: e.log_index,
    block: e.block,
    timestamp: 0, // not indexed yet; the explorer link (txHash) has the time
    args: JSON.parse(e.args_json) as Record<string, string>,
  }));
  const disputeStage = Number(d.status) >= 6; // ResolutionProposed and later
  return {
    id: String(id),
    draftId: linked?.draftId ?? "",
    title: linked?.sow.title ?? `Deal ${id}`,
    buyer: d.buyer,
    seller: d.seller,
    buyerName: accounts.displayName(d.buyer),
    sellerName: accounts.displayName(d.seller),
    amount: d.amount.toString(),
    status: s === "None" ? "Proposed" : s,
    sowHash: d.sowHash,
    deliverBy: Number(d.deliverBy),
    reviewPeriod: Number(d.reviewPeriod),
    ...(Number(d.deliveredAt) > 0 && { deliveredAt: Number(d.deliveredAt) }),
    ...(note && { deliveryNote: note.note }),
    ...((disputeStage || ruling) && { buyerBps: ruling?.buyerBps ?? Number(d.proposedBuyerBps) }),
    ...(s === "ResolutionProposed" && { accepted: { buyer: d.buyerAccepted, seller: d.sellerAccepted } }),
    ...(ruling && { ruledBy: ruling.source === "arbitrator" ? ("arbitrator" as const) : ("ai" as const) }),
    ...(ruling?.source === "arbitrator" && { arbitratorNote: String(ruling.ruling) }),
    ...(paid?.method && { paidWith: paid.method }),
    events,
  };
}

/** Deal ids known locally (from the indexer), optionally only those where `address` is a party. */
export function knownDealIds(address?: string): number[] {
  const rows = address
    ? db.prepare("SELECT id FROM deals WHERE lower(buyer) = ? OR lower(seller) = ? ORDER BY id DESC LIMIT 200").all(address.toLowerCase(), address.toLowerCase())
    : db.prepare("SELECT id FROM deals ORDER BY id DESC LIMIT 500").all();
  return (rows as { id: number }[]).map((r) => r.id);
}

/** Reads several deals from the chain (bounded concurrency); unknown ids are skipped. */
export async function loadDeals(ids: number[]): Promise<DealView[]> {
  const out: DealView[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(ids.slice(i, i + 10).map(async (id) => [id, await readOnchainDeal(id)] as const));
    for (const [id, d] of batch) if (d) out.push(toDealView(id, d));
  }
  return out;
}
