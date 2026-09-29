export type WeightedDeliverable = {
    id: string;
    weightBps: number;
};
export type DeliverableScore = {
    id: string;
    fulfilledPct: number;
};
/**
 * Validates and orders the inputs (in deliverable order). Shared by the TS formula and the WASM wrapper.
 * Throws unless weights are non-negative integers summing to 10000 and scores cover every deliverable exactly once
 * with integer fulfilledPct 0–100.
 */
export declare function orderSplitInputs(deliverables: readonly WeightedDeliverable[], scores: readonly DeliverableScore[]): {
    weights: number[];
    pcts: number[];
};
/** Buyer's refund share in basis points (0..10000). Throws unless scores cover every deliverable exactly once. */
export declare function computeBuyerBps(deliverables: readonly WeightedDeliverable[], scores: readonly DeliverableScore[]): number;
export type Verdict = "met" | "partial" | "not_met";
/**
 * Prompt v4 burden-of-proof basis for a verdict:
 *  - "admission":  the buyer/complaint says the criterion is satisfied        → verdict must be "met"
 *  - "undisputed": the complaint doesn't dispute it and no evidence contradicts it → verdict must be "met"
 *  - "evidence":   disputed, judged on the evidence                          → any verdict
 */
export type Basis = "admission" | "undisputed" | "evidence";
export declare const BASES: readonly Basis[];
/** Throws unless the basis is known and consistent with the verdict (admission/undisputed imply "met"). */
export declare function validateBasis(index: number, verdict: Verdict, basis: unknown): void;
/** One acceptance criterion's verdict. `satisfied`/`total` are required for "partial" (countable criteria only). */
export type CriterionVerdict = {
    index: number;
    verdict: Verdict;
    satisfied?: number;
    total?: number;
};
/** Throws unless the verdict is well-formed. met/not_met may carry counts only if consistent (n/n, 0/n). */
export declare function validateVerdict(v: CriterionVerdict): void;
/** met = 100, not_met = 0, partial = floor(100 × satisfied / total). */
export declare function criterionScore(v: CriterionVerdict): number;
/**
 * Orders verdicts by index after checking that indices 0..criteriaCount-1 each appear exactly once.
 * Shared by the TS and WASM paths.
 */
export declare function orderVerdicts(verdicts: readonly CriterionVerdict[], criteriaCount: number): CriterionVerdict[];
/** fulfilledPct = floor(mean of criterion scores), covering every criterion exactly once. */
export declare function fulfilledFromCriteria(verdicts: readonly CriterionVerdict[], criteriaCount: number): number;
