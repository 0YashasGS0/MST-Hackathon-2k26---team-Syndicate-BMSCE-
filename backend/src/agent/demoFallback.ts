// Ground-truth demo fallback — FOR THE LIVE DEMO ONLY, never a substitute for the agent in real use.
// When enabled (AGENT_DEMO_FALLBACK=true, or AGENT_FALLBACK_ON_FAILURE=true after every live model failed), a dispute
// whose SOW matches a demo scenario (backend/demo/scenarios) is ruled with that scenario's hand-written groundTruth
// verdicts. They go through the exact production path — criterionScore → fulfilledFromCriteria → computeBuyerBps →
// reasoning → hashJson — so the ruling verifies like any other; `model` says it was a fallback.
import { fulfilledFromCriteria, hashJson, type CriteriaScore, type Sow } from "@kernel-exploits/shared";
import { loadScenarios, type Scenario } from "./scenarios";

/** Thrown when a fallback is requested for a SOW that isn't a demo scenario — no generic fake ruling is produced. */
export class DemoFallbackError extends Error {}

/**
 * Identifies a scenario by what the ruling depends on (title, amount, deliverables with criteria and weights,
 * exclusions). Parties, token and deadlines are excluded on purpose: seeded demo drafts carry the real demo wallets
 * and a fresh deadline, so their full sowHash can't equal the fixture's.
 */
export function demoFingerprint(sow: Sow): string {
  return hashJson({ title: sow.title, amount: sow.amount, deliverables: sow.deliverables, exclusions: sow.exclusions });
}

let cached: Scenario[] | undefined;
export function findDemoScenario(sow: Sow, scenarios: Scenario[] = (cached ??= loadScenarios())): Scenario | undefined {
  const fp = demoFingerprint(sow);
  return scenarios.find((s) => demoFingerprint(s.sow) === fp); // A before D (sorted by id); they share one SOW and truth
}

/** The scenario's groundTruth as v3 criteria scores (fulfilledPct computed by the production function). */
export function groundTruthScores(sc: Scenario, sow: Sow): CriteriaScore[] {
  return sow.deliverables.map((d) => {
    const criteria = sc.groundTruth[d.id].map((v, index) => ({
      index,
      verdict: v.verdict,
      ...(v.satisfied !== undefined && { satisfied: v.satisfied }),
      ...(v.total !== undefined && { total: v.total }),
      rationale: `Demo fallback: ground-truth verdict for demo scenario ${sc.id} (${sc.name}); not produced by a model.`,
      evidenceRefs: [] as string[],
    }));
    return { id: d.id, fulfilledPct: fulfilledFromCriteria(criteria, d.acceptanceCriteria.length), criteria };
  });
}
