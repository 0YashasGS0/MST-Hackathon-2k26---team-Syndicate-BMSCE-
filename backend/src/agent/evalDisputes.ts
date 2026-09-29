// Eval harness logic (npm run eval:disputes): run each scenario N times through the real scoreDispute
// and check buyerBps against the scenario's expected range. Printing lives in scripts/eval-disputes.ts.
//
// Run outcomes:  ok    = valid ruling, buyerBps in range
//                fail  = valid ruling out of range, or the model's output never validated (quality problem)
//                error = API / rate-limit / network failure (says nothing about the prompt) — excluded from stats
// Scenario:      PASS | FAIL (any fail) | INCOMPLETE (no fails, but some runs errored or a baseline is missing)
import { hasCriteria, hashSow, type RulingScore } from "@kernel-exploits/shared";
import { SowStore } from "../sow/store";
import { retryDelayMsFrom, type BackoffOptions } from "./resilience";
import type { GroundTruthVerdict, Scenario } from "./scenarios";
import { scoreDispute } from "./scoreDispute";
import { AgentValidationError, type LlmChain } from "./toolRetry";

export type RunStatus = "ok" | "fail" | "error";
export type ScenarioStatus = "PASS" | "FAIL" | "INCOMPLETE";

export type EvalRow = {
  scenario: string;
  run: number;
  status: RunStatus;
  scores: RulingScore[]; // v1/v2: pct + rationale; v3: pct (computed) + per-criterion verdicts
  /** Non-transient attempts that failed validation: which model, and its errors (for INVALID diagnostics). */
  attempts: { attempt: number; model: string; error: string }[];
  /** Every LLM request of this run, in order (provider:model, HTTP status, tool mode, outcome). */
  calls: { attempt: number; model: string; status: number | null; toolMode: string | null; transient: boolean; ok: boolean }[];
  /** The last raw tool output (for printing verdicts of INVALID runs). */
  lastRaw?: unknown;
  /** v3: criteria whose verdict (and counts, for partial) equal groundTruth; null for v1/v2 or no ruling. */
  agreement: { agree: number; total: number } | null;
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
  agreement: { agree: number; total: number } | null; // summed over valid v3/v4 runs
  basisMix: { admission: number; undisputed: number; evidence: number } | null; // v4 verdict bases over valid runs
  relative?: { baseline: string; delta: number | null; maxDeltaBps: number; ok: boolean | null };
};

export type EvalOptions = {
  scenarios: Scenario[];
  runs: number;
  llm: LlmChain;
  promptVersion: string;
  delayMs?: number; // between calls (default 7000; env EVAL_DELAY_MS in the script)
  maxRetryDelayMs?: number; // cap for a 429's retryDelay (default 65000; per-model cooldowns prevent extra requests)
  relativeChecks?: RelativeCheck[];
  sleep?: (ms: number) => Promise<void>;
  backoff?: BackoffOptions;
  onRow?: (row: EvalRow) => void;
  onWait?: (ms: number, reason: string) => void;
  /** A model went on cooldown after a 429 (printed as "cooldown: <model> until +Ns"). */
  onCooldown?: (model: string, ms: number) => void;
};

export { retryDelayMsFrom };

export async function runEval(opts: EvalOptions): Promise<{ rows: EvalRow[]; summary: EvalSummary[] }> {
  const baseDelay = opts.delayMs ?? 7000;
  const cap = opts.maxRetryDelayMs ?? 65_000;
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
          scores: r.scores,
          attempts: [],
          calls: [],
          agreement: agreementWith(r.scores, sc.groundTruth),
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
          attempts: [],
          calls: [],
          agreement: null,
          buyerBps: null,
          inRange: false,
          model: "-",
          latencyMs: Date.now() - started,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      // Diagnostics from this run's audit rows: each failed validation attempt (model + errors), and the last raw output.
      const all = store.db
        .prepare("SELECT attempt, model, error, response_json, status_code, tool_mode, transient FROM agent_calls WHERE id > ? ORDER BY id")
        .all(lastLogId) as { attempt: number; model: string; error: string | null; response_json: string | null; status_code: number | null; tool_mode: string | null; transient: number }[];
      row.calls = all.map((l) => ({
        attempt: l.attempt,
        model: l.model,
        status: l.status_code ?? (l.transient ? null : 200),
        toolMode: l.tool_mode,
        transient: l.transient === 1,
        ok: !l.error,
      }));
      const logged = all.filter((l) => l.transient === 0);
      row.attempts = logged.filter((l) => l.error).map((l) => ({ attempt: l.attempt, model: l.model, error: l.error! }));
      const lastResponse = [...logged].reverse().find((l) => l.response_json);
      if (lastResponse) row.lastRaw = JSON.parse(lastResponse.response_json!);
      rows.push(row);
      opts.onRow?.(row);

      // Next wait: the base delay, or a 429's retryDelay (capped) if this run hit one.
      nextDelay = baseDelay;
      const hits = store.db
        .prepare("SELECT model, retry_delay_ms, error FROM agent_calls WHERE id > ? AND status_code = 429 ORDER BY id")
        .all(lastLogId) as { model: string; retry_delay_ms: number | null; error: string | null }[];
      const delays = hits.map((h) => h.retry_delay_ms ?? retryDelayMsFrom(h.error ?? "") ?? 0);
      hits.forEach((h, i) => opts.onCooldown?.(h.model, delays[i]));
      const retry = Math.max(0, ...delays);
      if (retry > 0) {
        nextDelay = Math.max(baseDelay, Math.min(retry, cap));
        opts.onWait?.(nextDelay, `429 retryDelay ${retry} ms${retry > cap ? ` (capped at ${cap} ms)` : ""}`);
      }
    }
  }
  return { rows, summary: summarize(opts.scenarios, rows, opts.relativeChecks ?? DEFAULT_RELATIVE_CHECKS) };
}

const sameVerdict = (a: { verdict: string; satisfied?: number; total?: number }, b: GroundTruthVerdict) =>
  a.verdict === b.verdict && (a.verdict !== "partial" || (a.satisfied === b.satisfied && a.total === b.total));

/** v3 only: how many criterion verdicts equal the ground truth (partial must also match the counts). */
export function agreementWith(scores: RulingScore[], gt: Record<string, GroundTruthVerdict[]>): { agree: number; total: number } | null {
  if (!scores.length || !scores.every(hasCriteria)) return null;
  let agree = 0;
  let total = 0;
  for (const s of scores) {
    const truth = gt[s.id] ?? [];
    total += truth.length;
    for (const c of s.criteria) if (truth[c.index] && sameVerdict(c, truth[c.index])) agree++;
  }
  return { agree, total };
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

    const agreed = mine.map((r) => r.agreement).filter((a): a is { agree: number; total: number } => a !== null);
    const agreement = agreed.length ? agreed.reduce((t, a) => ({ agree: t.agree + a.agree, total: t.total + a.total }), { agree: 0, total: 0 }) : null;

    const mix = { admission: 0, undisputed: 0, evidence: 0 };
    let sawBasis = false;
    for (const r of mine) {
      for (const s of r.scores) {
        if (!hasCriteria(s)) continue;
        for (const c of s.criteria) {
          if (!c.basis) continue;
          mix[c.basis]++;
          sawBasis = true;
        }
      }
    }

    return {
      scenario: sc.id,
      name: sc.name,
      status,
      agreement,
      basisMix: sawBasis ? mix : null,
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

const clip = (text: string, n: number) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

type LooseCriterion = { index?: unknown; verdict?: unknown; satisfied?: unknown; total?: unknown; rationale?: unknown };
const fmtVerdict = (c: { verdict?: unknown; satisfied?: unknown; total?: unknown }) =>
  c.verdict === "partial" ? `partial ${c.satisfied ?? "?"}/${c.total ?? "?"}` : String(c.verdict ?? "?");

/** Verdict lines for criteria-shaped scores (validated or raw), marked against ground truth. */
function verdictLines(scores: unknown, sc: Scenario): string[] {
  if (!Array.isArray(scores)) return [];
  const lines: string[] = [];
  for (const s of scores as { id?: unknown; criteria?: unknown }[]) {
    if (!Array.isArray(s?.criteria)) continue;
    for (const c of s.criteria as LooseCriterion[]) {
      const truth = typeof s.id === "string" && typeof c.index === "number" ? sc.groundTruth[s.id]?.[c.index] : undefined;
      const mark = truth ? `[truth: ${fmtVerdict(truth)} ${sameVerdict(c as { verdict: string }, truth) ? "✓" : "✗"}]` : "[truth: ?]";
      lines.push(`      ${String(s.id)} c${String(c.index)} ${fmtVerdict(c).padEnd(14)} ${mark.padEnd(26)} ${clip(String(c.rationale ?? ""), 160)}`);
    }
  }
  return lines;
}

/**
 * Detail lines for runs worth a look:
 *  - INVALID (model output never validated): each attempt's model + validation errors (≤300 chars), then the verdicts
 *    of the last raw output;
 *  - out of range: per-criterion verdicts (v3) or per-deliverable rationales (v1/v2), each ≤160 chars.
 */
export function formatDetails(r: EvalRow, sc: Scenario): string[] {
  if (r.status !== "fail") return [];
  if (r.buyerBps === null) {
    const lines = r.attempts.map((a) => `      attempt ${a.attempt} (${a.model}): ${clip(a.error, 300)}`);
    const raw = (r.lastRaw as { scores?: unknown } | undefined)?.scores;
    return [...lines, ...verdictLines(raw, sc)];
  }
  if (r.scores.some(hasCriteria)) return verdictLines(r.scores, sc);
  return r.scores.map((s) => `      ${s.id} (${s.fulfilledPct}): ${clip(hasCriteria(s) ? "" : s.rationale, 160)}`);
}

/** One line per LLM request of the run: provider:model, status, tool mode, outcome. */
export function formatCalls(r: EvalRow): string[] {
  return r.calls.map(
    (c) => `      · attempt ${c.attempt} ${c.model} status=${c.status ?? "network error"}${c.transient ? " (transient)" : ""} mode=${c.toolMode ?? "-"} ${c.ok ? "ok" : "failed"}`,
  );
}

export function formatSummary(s: EvalSummary): string[] {
  const lines = [
    `${s.scenario} ${s.name.padEnd(18)} valid runs: ${s.validRuns}/${s.runs}  min=${s.min ?? "-"} max=${s.max ?? "-"} spread=${s.spread ?? "-"} median=${s.median ?? "-"}  ${s.status}`,
  ];
  if (s.agreement) lines.push(`    criteria agreement ${s.agreement.agree}/${s.agreement.total}`);
  if (s.basisMix) lines.push(`    basis mix: ${fmtMix(s.basisMix)}`);
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

const fmtMix = (m: { admission: number; undisputed: number; evidence: number }) => `admission ${m.admission} · undisputed ${m.undisputed} · evidence ${m.evidence}`;

/** EVAL_COMPARE="groq:openai/gpt-oss-120b;gemini:gemini-2.5-flash" → one chain spec per entry (each may itself be a comma chain). */
export function parseEvalCompare(spec: string): string[] {
  return spec.split(";").map((s) => s.trim()).filter(Boolean);
}

export type CompareResult = { chain: string; summary: EvalSummary[]; rows: EvalRow[]; skipped?: string };

/** Side-by-side table: scenario | model | bps | in range | criteria agreement | basis mix. */
export function formatCompareTable(results: CompareResult[]): string[] {
  const header = ["scenario".padEnd(20), "model".padEnd(34), "bps (median; runs)".padEnd(26), "in range".padEnd(10), "agreement".padEnd(10), "basis mix"].join(" | ");
  const lines = [header, "-".repeat(header.length)];
  const ids = [...new Set(results.flatMap((r) => r.summary.map((s) => s.scenario)))];
  for (const id of ids) {
    for (const r of results) {
      if (r.skipped) {
        lines.push([`${id}`.padEnd(20), r.chain.padEnd(34), `skipped: ${r.skipped}`].join(" | "));
        continue;
      }
      const s = r.summary.find((x) => x.scenario === id);
      if (!s) continue;
      const bps = r.rows.filter((x) => x.scenario === id).map((x) => x.buyerBps ?? "ERR");
      const models = [...new Set(r.rows.filter((x) => x.scenario === id && x.buyerBps !== null).map((x) => x.model))];
      lines.push(
        [
          `${s.scenario} ${s.name}`.padEnd(20),
          (models.length ? models.join(", ") : r.chain).padEnd(34),
          `${s.median ?? "-"} (${bps.join(", ")})`.padEnd(26),
          s.status.padEnd(10),
          (s.agreement ? `${s.agreement.agree}/${s.agreement.total}` : "-").padEnd(10),
          s.basisMix ? fmtMix(s.basisMix) : "-",
        ].join(" | "),
      );
    }
  }
  return lines;
}

