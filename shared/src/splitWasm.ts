// Loads shared/dist/split.wasm (built from wasm/split.ts) and wraps it with the same validation as split.ts.
// Works in Node and the browser: takes the bytes, uses WebAssembly.instantiate, no fs here.
// Browser: loadSplitWasm(await (await fetch("/split.wasm")).arrayBuffer()). Node: loadSplitWasm(readFileSync(path)).
import { orderSplitInputs, type DeliverableScore, type WeightedDeliverable } from "./split";

export type SplitWasm = {
  computeBuyerBps(deliverables: readonly WeightedDeliverable[], scores: readonly DeliverableScore[]): number;
};

type Exports = {
  memory: WebAssembly.Memory;
  MAX_DELIVERABLES: WebAssembly.Global;
  weightsPtr(): number;
  pctsPtr(): number;
  computeBuyerBps(n: number): number;
};

export async function loadSplitWasm(bytes: ArrayBuffer | Uint8Array): Promise<SplitWasm> {
  // Copy into a fresh, exactly-sized ArrayBuffer. (Node's Buffer.slice() is a view on a shared pool, so its
  // .buffer would contain unrelated bytes — new Uint8Array(typedArray) always copies.)
  const source = bytes instanceof Uint8Array ? new Uint8Array(bytes).buffer : bytes;
  const { instance } = await WebAssembly.instantiate(source, {});
  const x = instance.exports as unknown as Exports;
  const max = Number(x.MAX_DELIVERABLES.value);

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
  };
}
