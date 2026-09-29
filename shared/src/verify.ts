// Pure ruling verifier — the same code runs in the backend (/deals/:id/verify) and in the browser verify page.
// Recomputes reasoningHash and the split from the stored reasoning object + SOW, and compares with the chain.
import { hashJson, hashSow } from "./hash.js";
import type { Sow } from "./sow.js";
import { computeBuyerBps, fulfilledFromCriteria, validateBasis, type Basis, type Verdict } from "./split.js";
import type { SplitWasm } from "./splitWasm.js";

/** One criterion verdict as stored in a v3 ruling (the LLM's output, plus nothing computed). */
export type CriterionResult = {
  index: number;
  verdict: Verdict;
  satisfied?: number;
  total?: number;
  /** v4 only: why the verdict was reached (admission / undisputed ⇒ met). Absent on v3 rulings. */
  basis?: Basis;
  rationale: string;
  evidenceRefs: string[];
};

/**
 * v1/v2 score: the LLM gave fulfilledPct directly.
 * v3 score: the LLM gave per-criterion verdicts; fulfilledPct was computed by fulfilledFromCriteria().
 */
export type PctScore = { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] };
export type CriteriaScore = { id: string; fulfilledPct: number; criteria: CriterionResult[] };
export type RulingScore = PctScore | CriteriaScore;

export const hasCriteria = (s: RulingScore): s is CriteriaScore => Array.isArray((s as CriteriaScore).criteria);

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
  fulfilledMatches: boolean | null; // v3/v4: every fulfilledPct === fulfilledFromCriteria(verdicts) and every verdict is well-formed (v4: basis rules); null for v1/v2 and arbitrator
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
  let fulfilledMatches: boolean | null = null;
  if (source === "agent") {
    const scores = (reasoning as Reasoning).scores;
    // v3: recompute each fulfilledPct from the stored verdicts (criteria counts come from the SOW).
    if (scores.some(hasCriteria)) {
      fulfilledMatches = scores.every((s) => {
        const d = sow.deliverables.find((x) => x.id === s.id);
        if (!d || !hasCriteria(s)) return false;
        try {
          for (const c of s.criteria) if (c.basis !== undefined) validateBasis(c.index, c.verdict, c.basis);
          const pct = fulfilledFromCriteria(s.criteria, d.acceptanceCriteria.length);
          if (wasm && wasm.fulfilledFromCriteria(s.criteria, d.acceptanceCriteria.length) !== pct) wasmMatchesTs = false;
          return pct === s.fulfilledPct;
        } catch {
          return false;
        }
      });
    }
    try {
      recomputedBps = computeBuyerBps(sow.deliverables, scores);
    } catch {
      recomputedBps = null;
    }
    bpsMatchesFormula = recomputedBps !== null && recomputedBps === reasoning.buyerBps;
    // arbitrate() leaves proposedBuyerBps stale by design, so this check applies to agent rulings only.
    bpsMatchesOnchain = onchainProposedBps === undefined ? null : reasoning.buyerBps === onchainProposedBps;
    if (wasm && wasmMatchesTs !== false) {
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
    hashMatches &&
    sowMatches &&
    bpsMatchesFormula !== false &&
    bpsMatchesOnchain !== false &&
    fulfilledMatches !== false &&
    settledMatches !== false &&
    wasmMatchesTs !== false;
  return { source, hashMatches, bpsMatchesFormula, bpsMatchesOnchain, fulfilledMatches, settledMatches, wasmMatchesTs, sowMatches, recomputedHash, recomputedBps, ok };
}
