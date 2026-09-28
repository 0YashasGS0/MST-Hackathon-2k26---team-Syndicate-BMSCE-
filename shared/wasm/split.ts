// AssemblyScript port of shared/src/split.ts — the same formulas, integer arithmetic only.
//   buyerBps           = Σ floor(weightBps × (100 − fulfilledPct) / 100)
//   criterion score    = met 100 | not_met 0 | partial floor(100 × satisfied / total)
//   fulfilledPct       = floor(Σ criterion scores / n)
// No validation here: shared/src/splitWasm.ts validates before calling in. With validated inputs every value is
// non-negative, so i32 division (truncation) == floor.
//
// ABI (no imports, no runtime, no JS glue): the host writes little-endian i32 values into the static buffers
// below, then calls the function with the element count.

const MAX: i32 = 64;
const WEIGHTS: usize = memory.data(MAX * 4);
const PCTS: usize = memory.data(MAX * 4);
const KINDS: usize = memory.data(MAX * 4); // 0 = not_met, 1 = partial, 2 = met
const SATISFIED: usize = memory.data(MAX * 4);
const TOTALS: usize = memory.data(MAX * 4);

export const MAX_DELIVERABLES: i32 = MAX;
export const MAX_CRITERIA: i32 = MAX;

export function weightsPtr(): usize {
  return WEIGHTS;
}
export function pctsPtr(): usize {
  return PCTS;
}
export function kindsPtr(): usize {
  return KINDS;
}
export function satisfiedPtr(): usize {
  return SATISFIED;
}
export function totalsPtr(): usize {
  return TOTALS;
}

export function computeBuyerBps(n: i32): i32 {
  let bps: i32 = 0;
  for (let i: i32 = 0; i < n; i++) {
    const w = load<i32>(WEIGHTS + (<usize>i << 2));
    const p = load<i32>(PCTS + (<usize>i << 2));
    bps += (w * (100 - p)) / 100;
  }
  return bps;
}

export function criterionScore(kind: i32, satisfied: i32, total: i32): i32 {
  if (kind == 2) return 100;
  if (kind == 0) return 0;
  return (100 * satisfied) / total;
}

export function fulfilledFromCriteria(n: i32): i32 {
  let sum: i32 = 0;
  for (let i: i32 = 0; i < n; i++) {
    const off = <usize>i << 2;
    sum += criterionScore(load<i32>(KINDS + off), load<i32>(SATISFIED + off), load<i32>(TOTALS + off));
  }
  return sum / n;
}
