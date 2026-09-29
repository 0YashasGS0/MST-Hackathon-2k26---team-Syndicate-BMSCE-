import type { Sow } from "./sow.js";
import { type Basis, type Verdict } from "./split.js";
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
export type PctScore = {
    id: string;
    fulfilledPct: number;
    rationale: string;
    evidenceRefs: string[];
};
export type CriteriaScore = {
    id: string;
    fulfilledPct: number;
    criteria: CriterionResult[];
};
export type RulingScore = PctScore | CriteriaScore;
export declare const hasCriteria: (s: RulingScore) => s is CriteriaScore;
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
export type Settlement = {
    toBuyer: bigint | string;
    amount: bigint | string;
};
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
    hashMatches: boolean;
    bpsMatchesFormula: boolean | null;
    bpsMatchesOnchain: boolean | null;
    fulfilledMatches: boolean | null;
    settledMatches: boolean | null;
    wasmMatchesTs: boolean | null;
    sowMatches: boolean;
    recomputedHash: string;
    recomputedBps: number | null;
    ok: boolean;
};
export declare function verifyRuling({ reasoning, onchainReasoningHash, onchainProposedBps, settled, sow, wasm }: VerifyInput): VerifyResult;
