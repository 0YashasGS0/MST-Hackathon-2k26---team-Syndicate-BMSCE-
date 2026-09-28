// Pure ruling verifier — the same code runs in the backend (/deals/:id/verify) and in the browser verify page.
// Recomputes reasoningHash and the split from the stored reasoning object + SOW, and compares with the chain.
import { hashJson, hashSow } from "./hash";
import type { Sow } from "./sow";
import { computeBuyerBps } from "./split";
import type { SplitWasm } from "./splitWasm";

export type RulingScore = { id: string; fulfilledPct: number; rationale: string; evidenceRefs: string[] };

/** Exactly what reasoningHash commits to (see docs/API.md `Reasoning`). */
export type Reasoning = {
  dealId: number;
  sowHash: string;
  deliveryHash: string;
  evidenceHash: string;
  scores: RulingScore[];
  buyerBps: number;
  model: string;
  promptVersion: string;
};

export type VerifyInput = {
  reasoning: Reasoning;
  onchainReasoningHash: string;
  onchainProposedBps?: number;
  sow: Sow;
  wasm?: SplitWasm;
};

export type VerifyResult = {
  hashMatches: boolean; // hashJson(reasoning) === on-chain reasoningHash
  bpsMatchesFormula: boolean; // reasoning.buyerBps === computeBuyerBps(sow, scores)
  bpsMatchesOnchain: boolean | null; // reasoning.buyerBps === on-chain proposedBuyerBps (null: not supplied)
  wasmMatchesTs: boolean | null; // WASM formula === TS formula (null: no wasm supplied)
  sowMatches: boolean; // reasoning.sowHash === hashSow(sow)
  recomputedHash: string;
  recomputedBps: number | null; // null if the scores don't fit the SOW (unknown/missing id, bad pct)
  ok: boolean; // every applicable check passed
};

const eqHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export function verifyRuling({ reasoning, onchainReasoningHash, onchainProposedBps, sow, wasm }: VerifyInput): VerifyResult {
  const recomputedHash = hashJson(reasoning);
  const hashMatches = eqHex(recomputedHash, onchainReasoningHash);

  let recomputedBps: number | null = null;
  try {
    recomputedBps = computeBuyerBps(sow.deliverables, reasoning.scores);
  } catch {
    recomputedBps = null;
  }
  const bpsMatchesFormula = recomputedBps !== null && recomputedBps === reasoning.buyerBps;
  const bpsMatchesOnchain = onchainProposedBps === undefined ? null : reasoning.buyerBps === onchainProposedBps;

  let wasmMatchesTs: boolean | null = null;
  if (wasm) {
    try {
      wasmMatchesTs = recomputedBps !== null && wasm.computeBuyerBps(sow.deliverables, reasoning.scores) === recomputedBps;
    } catch {
      wasmMatchesTs = false;
    }
  }

  let sowMatches = false;
  try {
    sowMatches = eqHex(reasoning.sowHash, hashSow(sow));
  } catch {
    sowMatches = false;
  }

  const ok = hashMatches && bpsMatchesFormula && sowMatches && bpsMatchesOnchain !== false && wasmMatchesTs !== false;
  return { hashMatches, bpsMatchesFormula, bpsMatchesOnchain, wasmMatchesTs, sowMatches, recomputedHash, recomputedBps, ok };
}
