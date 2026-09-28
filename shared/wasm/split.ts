// AssemblyScript port of computeBuyerBps (shared/src/split.ts) — the same formula, integer arithmetic only.
// buyerBps = Σ floor(weightBps × (100 − fulfilledPct) / 100)
// No validation here: shared/src/splitWasm.ts validates (ids exactly once, integers 0–100, weights sum 10000)
// before calling in. With validated inputs every product is non-negative, so i32 division (truncation) == floor.
//
// ABI (no imports, no runtime, no JS glue): the host writes n weights and n pcts as little-endian i32
// into the two static buffers below, then calls computeBuyerBps(n).

const MAX: i32 = 64;
const WEIGHTS: usize = memory.data(MAX * 4);
const PCTS: usize = memory.data(MAX * 4);

export const MAX_DELIVERABLES: i32 = MAX;

export function weightsPtr(): usize {
  return WEIGHTS;
}

export function pctsPtr(): usize {
  return PCTS;
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
