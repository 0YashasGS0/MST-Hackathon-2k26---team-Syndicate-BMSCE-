// B2 owns the real scoreDispute() (calls the LLM, validates, returns
// { scores, buyerBps, reasoningHash } — see TEAM_ROADMAP.md §2 "Hour 4-7").
// B1 only calls it. Until B2's module lands, this stub keeps /deals/:id/resolve
// wired up end-to-end so the rest of the flow (agent.proposeResolution, DB
// storage) can be built and demoed today. Swap the body for an import from
// B2's file the moment it's ready -- the call signature below is the contract
// between you two, so tell B2 to match it.
import { keccak256, stringToHex } from "viem";

export interface DisputeScore {
  id: string; // deliverable id, matches the SOW
  fulfilledPct: number; // 0-100 integer
  rationale: string;
  evidenceRefs: string[];
}

export interface ScoreDisputeResult {
  scores: DisputeScore[];
  buyerBps: number; // 0-10000, computed by shared/split.ts -- NOT by the LLM
  reasoningHash: `0x${string}`;
}

/**
 * TEMPORARY STUB. Replace with B2's real implementation:
 *   import { scoreDispute } from "../shared/score";
 * Signature must stay: (dealId, sow, deliveryFiles, evidenceFiles, complaintText) => ScoreDisputeResult
 */
export async function scoreDispute(
  dealId: number,
  sow: any,
  deliveryFiles: { path: string; keccak: string }[],
  evidenceFiles: { path: string; keccak: string }[],
  complaintText: string
): Promise<ScoreDisputeResult> {
  console.warn(`[scoreDispute STUB] deal ${dealId} — replace with B2's real scorer before the demo`);

  // Even split as a placeholder so the flow doesn't crash.
  const deliverables = sow?.deliverables ?? [{ id: "D1", weightBps: 10000 }];
  const scores: DisputeScore[] = deliverables.map((d: any) => ({
    id: d.id,
    fulfilledPct: 100,
    rationale: "stub: assumed fully delivered, replace with B2's scorer",
    evidenceRefs: [],
  }));

  const buyerBps = 0; // stub assumes seller fully delivered -> buyer gets 0 back

  const reasoningHash = keccak256(
    stringToHex(JSON.stringify({ dealId, scores, buyerBps, model: "stub", promptVersion: "0" }))
  );

  return { scores, buyerBps, reasoningHash };
}
