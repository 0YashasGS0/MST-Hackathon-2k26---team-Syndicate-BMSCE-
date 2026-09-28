// Loads shared/dist/split.wasm (built from wasm/split.ts) and wraps it with the same validation as split.ts.
// Works in Node and the browser: takes the bytes, uses WebAssembly.instantiate, no fs here.
// Browser: loadSplitWasm(await (await fetch("/split.wasm")).arrayBuffer()). Node: loadSplitWasm(readFileSync(path)).
import { orderSplitInputs, orderVerdicts, validateVerdict, type CriterionVerdict, type DeliverableScore, type WeightedDeliverable } from "./split";

export type SplitWasm = {
  computeBuyerBps(deliverables: readonly WeightedDeliverable[], scores: readonly DeliverableScore[]): number;
  criterionScore(verdict: CriterionVerdict): number;
  fulfilledFromCriteria(verdicts: readonly CriterionVerdict[], criteriaCount: number): number;
};

type Exports = {
  memory: WebAssembly.Memory;
  MAX_DELIVERABLES: WebAssembly.Global;
  MAX_CRITERIA: WebAssembly.Global;
  weightsPtr(): number;
  pctsPtr(): number;
  kindsPtr(): number;
  satisfiedPtr(): number;
  totalsPtr(): number;
  computeBuyerBps(n: number): number;
  criterionScore(kind: number, satisfied: number, total: number): number;
  fulfilledFromCriteria(n: number): number;
};

const KIND = { not_met: 0, partial: 1, met: 2 } as const;

export async function loadSplitWasm(bytes: ArrayBuffer | Uint8Array): Promise<SplitWasm> {
  // Copy into a fresh, exactly-sized ArrayBuffer. (Node's Buffer.slice() is a view on a shared pool, so its
  // .buffer would contain unrelated bytes — new Uint8Array(typedArray) always copies.)
  const source = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const { instance } = await WebAssembly.instantiate(source, {});
  const x = instance.exports as unknown as Exports;
  const max = Number(x.MAX_DELIVERABLES.value);
  const maxCriteria = Number(x.MAX_CRITERIA.value);
  // met/not_met don't use the counts; pass 0/1 so the WASM never divides by zero.
  const counts = (v: CriterionVerdict) => (v.verdict === "partial" ? [v.satisfied!, v.total!] : [0, 1]);

  return {
    computeBuyerBps(deliverables, scores) {
      const { weights, pcts } = orderSplitInputs(deliverables, scores);
      if (weights.length > max) throw new Error(`at most ${max} deliverables`);
      // Fresh view each call: the memory buffer can be replaced if it ever grows.
      const view = new DataView(x.memory.buffer);
      const w = x.weightsPtr();
      const p = x.pctsPtr();
      weights.forEach((v, i) => view.setInt32(w + i * 4, v, true));
      pcts.forEach((v, i) => view.setInt32(p + i * 4, v, true));
      return x.computeBuyerBps(weights.length);
    },

    criterionScore(v) {
      validateVerdict(v);
      const [s, t] = counts(v);
      return x.criterionScore(KIND[v.verdict], s, t);
    },

    fulfilledFromCriteria(verdicts, criteriaCount) {
      const ordered = orderVerdicts(verdicts, criteriaCount);
      if (ordered.length > maxCriteria) throw new Error(`at most ${maxCriteria} criteria per deliverable`);
      const view = new DataView(x.memory.buffer);
      const [k, s, t] = [x.kindsPtr(), x.satisfiedPtr(), x.totalsPtr()];
      ordered.forEach((v, i) => {
        const [sat, tot] = counts(v);
        view.setInt32(k + i * 4, KIND[v.verdict], true);
        view.setInt32(s + i * 4, sat, true);
        view.setInt32(t + i * 4, tot, true);
      });
      return x.fulfilledFromCriteria(ordered.length);
    },
  };
}
