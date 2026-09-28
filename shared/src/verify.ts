// Pure ruling verifier — the same code runs in the backend (/deals/:id/verify) and in the browser verify page.
// Recomputes reasoningHash and the split from the stored reasoning object + SOW, and compares with the chain.
import { hashJson, hashSow } from "./hash";
import type { Sow } from "./sow";
import { computeBuyerBps } from "./split";
import type { SplitWasm } from "./splitWasm";

export type RulingScore = { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] };

/**
 * Agent ruling: exactly what reasoningHash commits to (see docs/API.md `Reasoning`).
 * `source` is omitted on agent rulings (a missing source means "agent"), so existing hashes never change.
 */
export type Reasoning = {
  source?: "agent";
  dealId: number;
  sowHash: string;
  deliveryHash: string;
  evidenceHash: string;
  scores: RulingScore[];
  buyerBps: number;
  model: string;
  promptVersion: string;
};

/** Human arbitrator ruling (stored by B1 under the reasoningHash passed to arbitrate()). Extra fields allowed. */
export type ArbitratorReasoning = {
  source: "arbitrator";
  dealId: number;
  sowHash: string;
  buyerBps: number;
  ruling: string;
  [extra: string]: unknown;
};

export type AnyReasoning = Reasoning | ArbitratorReasoning;

/** From the Settled(id, toBuyer, toSeller, finalStatus) event; amount = toBuyer + toSeller. */
export type Settlement = { toBuyer: bigint | string; amount: bigint | string };

export type VerifyInput = {
  reasoning: AnyReasoning;
  onchainReasoningHash: string;
  onchainProposedBps?: number;
  settled?: Settlement;
  sow: Sow;
  wasm?: SplitWasm;
};

export type VerifyResult = {
  source: "agent" | "arbitrator";
  hashMatches: boolean; // hashJson(reasoning) === on-chain reasoningHash
  bpsMatchesFormula: boolean | null; // agent: reasoning.buyerBps === computeBuyerBps(sow, scores); arbitrator: null (a human decided)
  bpsMatchesOnchain: boolean | null; // agent: reasoning.buyerBps === on-chain proposedBuyerBps (null: not supplied); arbitrator: null
  settledMatches: boolean | null; // floor(amount × buyerBps / 10000) === Settled.toBuyer (null: no settlement supplied)
  wasmMatchesTs: boolean | null; // WASM formula === TS formula (null: no wasm supplied, or arbitrator)
  sowMatches: boolean; // reasoning.sowHash === hashSow(sow)
  recomputedHash: string;
  recomputedBps: number | null; // null if the scores don't fit the SOW (unknown/missing id, bad pct)
  ok: boolean; // every applicable check passed
};

const eqHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function verifyRuling({ reasoning, onchainReasoningHash, onchainProposedBps, settled, sow, wasm }: VerifyInput): VerifyResult {
  const source = reasoning.source === "arbitrator" ? "arbitrator" : "agent";
  const recomputedHash = hashJson(reasoning);
  const hashMatches = eqHex(recomputedHash, onchainReasoningHash);

  let recomputedBps: number | null = null;
  let bpsMatchesFormula: boolean | null = null;
  let bpsMatchesOnchain: boolean | null = null;
  let wasmMatchesTs: boolean | null = null;
  if (source === "agent") {
    const scores = (reasoning as Reasoning).scores;
    try {
      recomputedBps = computeBuyerBps(sow.deliverables, scores);
    } catch {
      recomputedBps = null;
    }
    bpsMatchesFormula = recomputedBps !== null && recomputedBps === reasoning.buyerBps;
    // arbitrate() leaves proposedBuyerBps stale by design, so this check applies to agent rulings only.
    bpsMatchesOnchain = onchainProposedBps === undefined ? null : reasoning.buyerBps === onchainProposedBps;
    if (wasm) {
      try {
        wasmMatchesTs = recomputedBps !== null && wasm.computeBuyerBps(sow.deliverables, scores) === recomputedBps;
      } catch {
        wasmMatchesTs = false;
      }
    }
  }

  // Mirrors DealEscrow._settle: toBuyer = amount * buyerBps / BPS (integer division).
  let settledMatches: boolean | null = null;
  if (settled) {
    try {
      settledMatches = (BigInt(settled.amount) * BigInt(reasoning.buyerBps)) / 10_000n === BigInt(settled.toBuyer);
    } catch {
      settledMatches = false;
    }
  }

  let sowMatches = false;
  try {
    sowMatches = eqHex(reasoning.sowHash, hashSow(sow));
  } catch {
    sowMatches = false;
  }

  const ok =
    hashMatches && sowMatches && bpsMatchesFormula !== false && bpsMatchesOnchain !== false && settledMatches !== false && wasmMatchesTs !== false;
  return { source, hashMatches, bpsMatchesFormula, bpsMatchesOnchain, settledMatches, wasmMatchesTs, sowMatches, recomputedHash, recomputedBps, ok };
}
