// Eval harness logic (npm run eval:disputes): run each scenario N times through the real scoreDispute
// and check buyerBps against the scenario's expected range. Printing lives in scripts/eval-disputes.ts.
//
// Run outcomes:  ok    = valid ruling, buyerBps in range
//                fail  = valid ruling out of range, or the model's output never validated (quality problem)
//                error = API / rate-limit / network failure (says nothing about the prompt) — excluded from stats
// Scenario:      PASS | FAIL (any fail) | INCOMPLETE (no fails, but some runs errored or a baseline is missing)
import { hashSow } from "@kernel-exploits/shared";
import { SowStore } from "../sow/store";
import type { BackoffOptions } from "./resilience";
import type { Scenario } from "./scenarios";
import { scoreDispute } from "./scoreDispute";
import { AgentValidationError, type LlmChain } from "./toolRetry";

export type RunStatus = "ok" | "fail" | "error";
export type ScenarioStatus = "PASS" | "FAIL" | "INCOMPLETE";

export type EvalRow = {
  scenario: string;
  run: number;
  status: RunStatus;
  scores: { id: string; fulfilledPct: number; rationale: string }[];
  buyerBps: number | null; // null when no valid ruling
  inRange: boolean;
  model: string;
  latencyMs: number;
  error?: string;
};

/** "Scenario X must score like its baseline": |median(X) − median(baseline)| ≤ maxDeltaBps. */
export type RelativeCheck = { scenario: string; baseline: string; maxDeltaBps: number };
export const DEFAULT_RELATIVE_CHECKS: RelativeCheck[] = [{ scenario: "D", baseline: "A", maxDeltaBps: 500 }];

export type EvalSummary = {
  scenario: string;
  name: string;
  status: ScenarioStatus;
  pass: boolean;
  runs: number;
  validRuns: number; // runs that were not API errors
  min: number | null;
  max: number | null;
  spread: number | null;
  median: number | null;
  relative?: { baseline: string; delta: number | null; maxDeltaBps: number; ok: boolean | null };
};

export type EvalOptions = {
  scenarios: Scenario[];
  runs: number;
  llm: LlmChain;
  promptVersion: string;
  delayMs?: number; // between calls (default 7000; env EVAL_DELAY_MS in the script)
  maxRetryDelayMs?: number; // cap for a 429's retryDelay (default 30000)
  relativeChecks?: RelativeCheck[];
  sleep?: (ms: number) => Promise<void>;
  backoff?: BackoffOptions;
  onRow?: (row: EvalRow) => void;
  onWait?: (ms: number, reason: string) => void;
};

/** Gemini's RetryInfo (`"retryDelay": "23s"`) from an error message, in ms. */
export function retryDelayMsFrom(message: string): number | null {
  const m = message.match(/"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s"?/);
  return m ? Math.round(Number(m[1]) * 1000) : null;
}

export async function runEval(opts: EvalOptions): Promise<{ rows: EvalRow[]; summary: EvalSummary[] }> {
  const baseDelay = opts.delayMs ?? 7000;
  const cap = opts.maxRetryDelayMs ?? 30_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const store = new SowStore(":memory:"); // never touches the real DB; also where 429 retryDelays are read from
  const rows: EvalRow[] = [];
  let nextDelay = 0;

  for (const sc of opts.scenarios) {
    for (let run = 1; run <= opts.runs; run++) {
      if (nextDelay > 0) await sleep(nextDelay);
      const lastLogId = (store.db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM agent_calls").get() as { id: number }).id;
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
        const inRange = r.buyerBps >= sc.expectedBuyerBps.min && r.buyerBps <= sc.expectedBuyerBps.max;
        row = {
          scenario: sc.id,
          run,
          status: inRange ? "ok" : "fail",
          scores: r.scores.map(({ id, fulfilledPct, rationale }) => ({ id, fulfilledPct, rationale })),
          buyerBps: r.buyerBps,
          inRange,
          model: r.model,
          latencyMs: Date.now() - started,
        };
      } catch (err) {
        row = {
          scenario: sc.id,
          run,
          status: err instanceof AgentValidationError ? "fail" : "error",
          scores: [],
          buyerBps: null,
          inRange: false,
          model: "-",
          latencyMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      rows.push(row);
      opts.onRow?.(row);

      // Next wait: the base delay, or a 429's retryDelay (capped) if this run hit one.
      nextDelay = baseDelay;
      const hits = store.db
        .prepare("SELECT error FROM agent_calls WHERE id > ? AND status_code = 429 AND error IS NOT NULL")
        .all(lastLogId) as { error: string }[];
      const retry = Math.max(0, ...hits.map((h) => retryDelayMsFrom(h.error) ?? 0));
      if (retry > 0) {
        nextDelay = Math.max(baseDelay, Math.min(retry, cap));
        opts.onWait?.(nextDelay, `429 retryDelay ${retry} ms${retry > cap ? ` (capped at ${cap} ms)` : ""}`);
      }
    }
  }
  return { rows, summary: summarize(opts.scenarios, rows, opts.relativeChecks ?? DEFAULT_RELATIVE_CHECKS) };
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function summarize(scenarios: Scenario[], rows: EvalRow[], relativeChecks: RelativeCheck[] = DEFAULT_RELATIVE_CHECKS): EvalSummary[] {
  const bpsOf = (id: string) => rows.filter((r) => r.scenario === id && r.buyerBps !== null).map((r) => r.buyerBps!);

  return scenarios.map((sc) => {
    const mine = rows.filter((r) => r.scenario === sc.id);
    const valid = mine.filter((r) => r.status !== "error");
    const bps = bpsOf(sc.id);
    const min = bps.length ? Math.min(...bps) : null;
    const max = bps.length ? Math.max(...bps) : null;

    let status: ScenarioStatus = mine.some((r) => r.status === "fail")
      ? "FAIL"
      : valid.length === 0 || valid.length < mine.length
        ? "INCOMPLETE"
        : "PASS";

    let relative: EvalSummary["relative"];
    const check = relativeChecks.find((c) => c.scenario === sc.id);
    if (check) {
      const mBase = median(bpsOf(check.baseline));
      const mMine = median(bps);
      const delta = mBase === null || mMine === null ? null : Math.abs(mMine - mBase);
      const ok = delta === null ? null : delta <= check.maxDeltaBps;
      relative = { baseline: check.baseline, delta, maxDeltaBps: check.maxDeltaBps, ok };
      if (ok === false) status = "FAIL";
      else if (ok === null && status === "PASS") status = "INCOMPLETE"; // no valid baseline (or own) runs to compare
    }

    return {
      scenario: sc.id,
      name: sc.name,
      status,
      pass: status === "PASS",
      runs: mine.length,
      validRuns: valid.length,
      min,
      max,
      spread: min !== null && max !== null ? max - min : null,
      median: median(bps),
      ...(relative && { relative }),
    };
  });
}

/** Fixed-width table line (no prompts, no keys — only scores, bps, model, latency). */
export function formatRow(r: EvalRow, sc: Scenario): string {
  const scores = r.error ? `${r.status === "error" ? "ERROR" : "INVALID"}: ${r.error.slice(0, 80)}` : r.scores.map((s) => `${s.id}=${s.fulfilledPct}`).join(" ");
  const range = `${sc.expectedBuyerBps.min}–${sc.expectedBuyerBps.max}`;
  const verdict = r.status === "error" ? "ERROR" : r.inRange ? "yes" : "NO ";
  return [sc.id.padEnd(3), String(r.run).padStart(3), scores.padEnd(28), String(r.buyerBps ?? "-").padStart(6), `${verdict} (${range})`.padEnd(20), r.model.padEnd(24), `${r.latencyMs} ms`].join(" | ");
}

/** Per-deliverable rationale lines for an out-of-range run (each truncated to 160 chars); [] otherwise. */
export function formatRationales(r: EvalRow): string[] {
  if (r.status !== "fail" || !r.scores.length) return [];
  return r.scores.map((s) => {
    const text = s.rationale.replace(/\s+/g, " ").trim();
    return `      ${s.id} (${s.fulfilledPct}): ${text.length > 160 ? `${text.slice(0, 159)}…` : text}`;
  });
}

export function formatSummary(s: EvalSummary): string[] {
  const lines = [
    `${s.scenario} ${s.name.padEnd(18)} valid runs: ${s.validRuns}/${s.runs}  min=${s.min ?? "-"} max=${s.max ?? "-"} spread=${s.spread ?? "-"} median=${s.median ?? "-"}  ${s.status}`,
  ];
  if (s.relative) {
    const r = s.relative;
    lines.push(
      r.delta === null
        ? `    injection effect: Δ = n/a (no valid runs for ${r.baseline} or ${s.scenario})`
        : `    injection effect: Δ = ${r.delta} bps vs ${r.baseline} (max ${r.maxDeltaBps}) ${r.ok ? "ok" : "TOO LARGE"}`,
    );
  }
  return lines;
}
