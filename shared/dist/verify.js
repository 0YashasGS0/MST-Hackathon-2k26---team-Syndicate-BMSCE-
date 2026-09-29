// Pure ruling verifier — the same code runs in the backend (/deals/:id/verify) and in the browser verify page.
// Recomputes reasoningHash and the split from the stored reasoning object + SOW, and compares with the chain.
import { hashJson, hashSow } from "./hash.js";
import { computeBuyerBps, fulfilledFromCriteria, validateBasis } from "./split.js";
export const hasCriteria = (s) => Array.isArray(s.criteria);
const eqHex = (a, b) => a.toLowerCase() === b.toLowerCase();
export function verifyRuling({ reasoning, onchainReasoningHash, onchainProposedBps, settled, sow, wasm }) {
    const source = reasoning.source === "arbitrator" ? "arbitrator" : "agent";
    const recomputedHash = hashJson(reasoning);
    const hashMatches = eqHex(recomputedHash, onchainReasoningHash);
    let recomputedBps = null;
    let bpsMatchesFormula = null;
    let bpsMatchesOnchain = null;
    let wasmMatchesTs = null;
    let fulfilledMatches = null;
    if (source === "agent") {
        const scores = reasoning.scores;
        // v3: recompute each fulfilledPct from the stored verdicts (criteria counts come from the SOW).
        if (scores.some(hasCriteria)) {
            fulfilledMatches = scores.every((s) => {
                const d = sow.deliverables.find((x) => x.id === s.id);
                if (!d || !hasCriteria(s))
                    return false;
                try {
                    for (const c of s.criteria)
                        if (c.basis !== undefined)
                            validateBasis(c.index, c.verdict, c.basis);
                    const pct = fulfilledFromCriteria(s.criteria, d.acceptanceCriteria.length);
                    if (wasm && wasm.fulfilledFromCriteria(s.criteria, d.acceptanceCriteria.length) !== pct)
                        wasmMatchesTs = false;
                    return pct === s.fulfilledPct;
                }
                catch {
                    return false;
                }
            });
        }
        try {
            recomputedBps = computeBuyerBps(sow.deliverables, scores);
        }
        catch {
            recomputedBps = null;
        }
        bpsMatchesFormula = recomputedBps !== null && recomputedBps === reasoning.buyerBps;
        // arbitrate() leaves proposedBuyerBps stale by design, so this check applies to agent rulings only.
        bpsMatchesOnchain = onchainProposedBps === undefined ? null : reasoning.buyerBps === onchainProposedBps;
        if (wasm && wasmMatchesTs !== false) {
            try {
                wasmMatchesTs = recomputedBps !== null && wasm.computeBuyerBps(sow.deliverables, scores) === recomputedBps;
            }
            catch {
                wasmMatchesTs = false;
            }
        }
    }
    // Mirrors DealEscrow._settle: toBuyer = amount * buyerBps / BPS (integer division).
    let settledMatches = null;
    if (settled) {
        try {
            settledMatches = (BigInt(settled.amount) * BigInt(reasoning.buyerBps)) / 10000n === BigInt(settled.toBuyer);
        }
        catch {
            settledMatches = false;
        }
    }
    let sowMatches = false;
    try {
        sowMatches = eqHex(reasoning.sowHash, hashSow(sow));
    }
    catch {
        sowMatches = false;
    }
    const ok = hashMatches &&
        sowMatches &&
        bpsMatchesFormula !== false &&
        bpsMatchesOnchain !== false &&
        fulfilledMatches !== false &&
        settledMatches !== false &&
        wasmMatchesTs !== false;
    return { source, hashMatches, bpsMatchesFormula, bpsMatchesOnchain, fulfilledMatches, settledMatches, wasmMatchesTs, sowMatches, recomputedHash, recomputedBps, ok };
}
