// Eval harness logic (npm run eval:disputes): run each scenario N times through the real scoreDispute
// and check buyerBps against the scenario's expected range. Printing lives in scripts/eval-disputes.ts.
import { hashSow } from "@kernel-exploits/shared";
import { SowStore } from "../sow/store";
import type { BackoffOptions } from "./resilience";
import type { Scenario } from "./scenarios";
import { scoreDispute } from "./scoreDispute";
import type { LlmChain } from "./toolRetry";

export type EvalRow = {
  scenario: string;
  run: number;
  scores: { id: string; fulfilledPct: number }[];
  buyerBps: number | null; // null = the run errored
  inRange: boolean;
  model: string;
  latencyMs: number;
  error?: string;
};

export type EvalSummary = { scenario: string; name: string; min: number | null; max: number | null; spread: number | null; runs: number; pass: boolean };

export type EvalOptions = {
  scenarios: Scenario[];
  runs: number;
  llm: LlmChain;
  promptVersion: string;
  delayMs?: number; // between calls (default 2000, rate-limit friendly)
  sleep?: (ms: number) => Promise<void>;
  backoff?: BackoffOptions;
  onRow?: (row: EvalRow) => void;
};

export async function runEval(opts: EvalOptions): Promise<{ rows: EvalRow[]; summary: EvalSummary[] }> {
  const delay = opts.delayMs ?? 2000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const store = new SowStore(":memory:"); // never touches the real DB
  const rows: EvalRow[] = [];
  let first = true;

  for (const sc of opts.scenarios) {
    for (let run = 1; run <= opts.runs; run++) {
      if (!first && delay > 0) await sleep(delay);
      first = false;
      const started = Date.now();
      let row: EvalRow;
      try {
        const r = await scoreDispute(
          {
            dealId: 0,
            sow: sc.sow,
            sowHash: hashSow(sc.sow),
            deliveryHash: "0x" + "00".repeat(32),
            evidenceHash: "0x" + "00".repeat(32),
            complaint: sc.complaint,
            deliveryNotes: sc.deliveryNotes,
            evidenceNotes: sc.evidenceNotes,
          },
          { llm: opts.llm, store, demoFallback: false, promptVersion: opts.promptVersion, backoff: opts.backoff },
        );
        row = {
          scenario: sc.id,
          run,
          scores: r.scores.map(({ id, fulfilledPct }) => ({ id, fulfilledPct })),
          buyerBps: r.buyerBps,
          inRange: r.buyerBps >= sc.expectedBuyerBps.min && r.buyerBps <= sc.expectedBuyerBps.max,
          model: r.model,
          latencyMs: Date.now() - started,
        };
      } catch (err) {
        row = { scenario: sc.id, run, scores: [], buyerBps: null, inRange: false, model: "-", latencyMs: Date.now() - started, error: err instanceof Error ? err.message : String(err) };
      }
      rows.push(row);
      opts.onRow?.(row);
    }
  }
  return { rows, summary: summarize(opts.scenarios, rows) };
}

export function summarize(scenarios: Scenario[], rows: EvalRow[]): EvalSummary[] {
  return scenarios.map((sc) => {
    const mine = rows.filter((r) => r.scenario === sc.id);
    const bps = mine.map((r) => r.buyerBps).filter((b): b is number => b !== null);
    const min = bps.length ? Math.min(...bps) : null;
    const max = bps.length ? Math.max(...bps) : null;
    return {
      scenario: sc.id,
      name: sc.name,
      min,
      max,
      spread: min !== null && max !== null ? max - min : null,
      runs: mine.length,
      pass: mine.length > 0 && mine.every((r) => r.inRange),
    };
  });
}

/** Fixed-width table lines (no prompts, no keys — only scores, bps, model, latency). */
export function formatRow(r: EvalRow, sc: Scenario): string {
  const scores = r.error ? `ERROR: ${r.error.slice(0, 80)}` : r.scores.map((s) => `${s.id}=${s.fulfilledPct}`).join(" ");
  const range = `${sc.expectedBuyerBps.min}–${sc.expectedBuyerBps.max}`;
  return [sc.id.padEnd(3), String(r.run).padStart(3), scores.padEnd(28), String(r.buyerBps ?? "-").padStart(6), `${r.inRange ? "yes" : "NO "} (${range})`.padEnd(18), r.model.padEnd(24), `${r.latencyMs} ms`].join(" | ");
}

export function formatSummary(s: EvalSummary): string {
  return `${s.scenario} ${s.name.padEnd(18)} min=${s.min ?? "-"} max=${s.max ?? "-"} spread=${s.spread ?? "-"} runs=${s.runs}  ${s.pass ? "PASS" : "FAIL"}`;
}
