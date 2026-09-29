// Dispute split formula — the ONLY place the split is computed (backend, browser verify page, WASM port).
// buyerBps = Σ floor(weightBps × (100 − fulfilledPct) / 100). Integer math only.
import { TOTAL_BPS } from "./sow.js";
/**
 * Validates and orders the inputs (in deliverable order). Shared by the TS formula and the WASM wrapper.
 * Throws unless weights are non-negative integers summing to 10000 and scores cover every deliverable exactly once
 * with integer fulfilledPct 0–100.
 */
export function orderSplitInputs(deliverables, scores) {
    let weightSum = 0;
    for (const d of deliverables) {
        if (!Number.isInteger(d.weightBps) || d.weightBps < 0)
            throw new Error(`deliverable ${d.id}: weightBps must be a non-negative integer`);
        weightSum += d.weightBps;
    }
    if (weightSum !== TOTAL_BPS)
        throw new Error(`deliverable weights must sum to ${TOTAL_BPS}, got ${weightSum}`);
    const byId = new Map();
    for (const s of scores) {
        if (byId.has(s.id))
            throw new Error(`duplicate score for deliverable ${s.id}`);
        if (!Number.isInteger(s.fulfilledPct) || s.fulfilledPct < 0 || s.fulfilledPct > 100) {
            throw new Error(`deliverable ${s.id}: fulfilledPct must be an integer from 0 to 100`);
        }
        byId.set(s.id, s.fulfilledPct);
    }
    const ids = new Set(deliverables.map((d) => d.id));
    if (ids.size !== deliverables.length)
        throw new Error("deliverable ids must be unique");
    for (const id of byId.keys())
        if (!ids.has(id))
            throw new Error(`score for unknown deliverable ${id}`);
    const pcts = deliverables.map((d) => {
        const pct = byId.get(d.id);
        if (pct === undefined)
            throw new Error(`missing score for deliverable ${d.id}`);
        return pct;
    });
    return { weights: deliverables.map((d) => d.weightBps), pcts };
}
/** Buyer's refund share in basis points (0..10000). Throws unless scores cover every deliverable exactly once. */
export function computeBuyerBps(deliverables, scores) {
    const { weights, pcts } = orderSplitInputs(deliverables, scores);
    let bps = 0;
    for (let i = 0; i < weights.length; i++)
        bps += Math.floor((weights[i] * (100 - pcts[i])) / 100);
    return bps;
}
export const BASES = ["admission", "undisputed", "evidence"];
/** Throws unless the basis is known and consistent with the verdict (admission/undisputed imply "met"). */
export function validateBasis(index, verdict, basis) {
    if (!BASES.includes(basis))
        throw new Error(`criterion ${index}: basis must be one of ${BASES.join(", ")}`);
    if ((basis === "admission" || basis === "undisputed") && verdict !== "met") {
        throw new Error(`criterion ${index}: basis "${basis}" requires verdict "met" (got "${verdict}")`);
    }
}
const isInt = (n) => typeof n === "number" && Number.isInteger(n);
/** Throws unless the verdict is well-formed. met/not_met may carry counts only if consistent (n/n, 0/n). */
export function validateVerdict(v) {
    const has = v.satisfied !== undefined || v.total !== undefined;
    if (has || v.verdict === "partial") {
        if (!isInt(v.satisfied) || !isInt(v.total))
            throw new Error(`criterion ${v.index}: "${v.verdict}" needs integer satisfied and total`);
        if (v.total < 1)
            throw new Error(`criterion ${v.index}: total must be >= 1`);
        if (v.satisfied < 0 || v.satisfied > v.total)
            throw new Error(`criterion ${v.index}: satisfied must be between 0 and total`);
        if (v.verdict === "met" && v.satisfied !== v.total)
            throw new Error(`criterion ${v.index}: "met" with ${v.satisfied}/${v.total} is contradictory`);
        if (v.verdict === "not_met" && v.satisfied !== 0)
            throw new Error(`criterion ${v.index}: "not_met" with ${v.satisfied}/${v.total} is contradictory`);
    }
    if (!["met", "partial", "not_met"].includes(v.verdict))
        throw new Error(`criterion ${v.index}: unknown verdict "${v.verdict}"`);
}
/** met = 100, not_met = 0, partial = floor(100 × satisfied / total). */
export function criterionScore(v) {
    validateVerdict(v);
    if (v.verdict === "met")
        return 100;
    if (v.verdict === "not_met")
        return 0;
    return Math.floor((100 * v.satisfied) / v.total);
}
/**
 * Orders verdicts by index after checking that indices 0..criteriaCount-1 each appear exactly once.
 * Shared by the TS and WASM paths.
 */
export function orderVerdicts(verdicts, criteriaCount) {
    if (!isInt(criteriaCount) || criteriaCount < 1)
        throw new Error("criteriaCount must be a positive integer");
    const byIndex = new Map();
    for (const v of verdicts) {
        if (!isInt(v.index) || v.index < 0 || v.index >= criteriaCount)
            throw new Error(`criterion index ${v.index} is out of range 0..${criteriaCount - 1}`);
        if (byIndex.has(v.index))
            throw new Error(`criterion index ${v.index} appears more than once`);
        validateVerdict(v);
        byIndex.set(v.index, v);
    }
    const out = [];
    for (let i = 0; i < criteriaCount; i++) {
        const v = byIndex.get(i);
        if (!v)
            throw new Error(`missing verdict for criterion index ${i}`);
        out.push(v);
    }
    return out;
}
/** fulfilledPct = floor(mean of criterion scores), covering every criterion exactly once. */
export function fulfilledFromCriteria(verdicts, criteriaCount) {
    const ordered = orderVerdicts(verdicts, criteriaCount);
    const sum = ordered.reduce((s, v) => s + criterionScore(v), 0);
    return Math.floor(sum / criteriaCount);
}
