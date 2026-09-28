// Dispute split formula — the ONLY place the split is computed (backend, browser verify page, WASM port).
// buyerBps = Σ floor(weightBps × (100 − fulfilledPct) / 100). Integer math only.
import { TOTAL_BPS } from "./sow";

export type WeightedDeliverable = { id: string; weightBps: number };
export type DeliverableScore = { id: string; fulfilledPct: number };

/**
 * Validates and orders the inputs (in deliverable order). Shared by the TS formula and the WASM wrapper.
 * Throws unless weights are non-negative integers summing to 10000 and scores cover every deliverable exactly once
 * with integer fulfilledPct 0–100.
 */
export function orderSplitInputs(
  deliverables: readonly WeightedDeliverable[],
  scores: readonly DeliverableScore[],
): { weights: number[]; pcts: number[] } {
  let weightSum = 0;
  for (const d of deliverables) {
    if (!Number.isInteger(d.weightBps) || d.weightBps < 0) throw new Error(`deliverable ${d.id}: weightBps must be a non-negative integer`);
    weightSum += d.weightBps;
  }
  if (weightSum !== TOTAL_BPS) throw new Error(`deliverable weights must sum to ${TOTAL_BPS}, got ${weightSum}`);

  const byId = new Map<string, number>();
  for (const s of scores) {
    if (byId.has(s.id)) throw new Error(`duplicate score for deliverable ${s.id}`);
    if (!Number.isInteger(s.fulfilledPct) || s.fulfilledPct < 0 || s.fulfilledPct > 100) {
      throw new Error(`deliverable ${s.id}: fulfilledPct must be an integer from 0 to 100`);
    }
    byId.set(s.id, s.fulfilledPct);
  }
  const ids = new Set(deliverables.map((d) => d.id));
  if (ids.size !== deliverables.length) throw new Error("deliverable ids must be unique");
  for (const id of byId.keys()) if (!ids.has(id)) throw new Error(`score for unknown deliverable ${id}`);

  const pcts = deliverables.map((d) => {
    const pct = byId.get(d.id);
    if (pct === undefined) throw new Error(`missing score for deliverable ${d.id}`);
    return pct;
  });
  return { weights: deliverables.map((d) => d.weightBps), pcts };
}

/** Buyer's refund share in basis points (0..10000). Throws unless scores cover every deliverable exactly once. */
export function computeBuyerBps(deliverables: readonly WeightedDeliverable[], scores: readonly DeliverableScore[]): number {
  const { weights, pcts } = orderSplitInputs(deliverables, scores);
  let bps = 0;
  for (let i = 0; i < weights.length; i++) bps += Math.floor((weights[i] * (100 - pcts[i])) / 100);
  return bps;
}
