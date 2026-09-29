import { type CriterionVerdict, type DeliverableScore, type WeightedDeliverable } from "./split.js";
export type SplitWasm = {
    computeBuyerBps(deliverables: readonly WeightedDeliverable[], scores: readonly DeliverableScore[]): number;
    criterionScore(verdict: CriterionVerdict): number;
    fulfilledFromCriteria(verdicts: readonly CriterionVerdict[], criteriaCount: number): number;
};
export declare function loadSplitWasm(bytes: ArrayBuffer | Uint8Array): Promise<SplitWasm>;
