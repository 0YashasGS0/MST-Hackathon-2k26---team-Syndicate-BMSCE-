// Runs every demo scenario EVAL_RUNS times (default 3) through the real scoreDispute with the configured
// provider/model/fallbacks and AGENT_PROMPT_VERSION. EVAL_DELAY_MS (default 7000) between calls, longer after a
// 429 that carries a retryDelay (up to 65 s). Never prints the key or prompts.
// Usage: npm run eval:disputes      (compare prompts: AGENT_PROMPT_VERSION=v3 npm run eval:disputes; default v4)
// Filters: EVAL_SCENARIOS=A,D (default: all), EVAL_RUNS=3. The chain comes from LLM_CHAIN (or the legacy LLM_* vars).
// Cross-model: EVAL_COMPARE="groq:openai/gpt-oss-120b;gemini:gemini-2.5-flash" runs the scenarios once per entry, in
// sequence (each entry is an LLM_CHAIN spec), then prints a side-by-side table.
import "./_env";
import { createLlmChain } from "../src/agent/createLlmClient";
import { DEFAULT_RELATIVE_CHECKS, formatCalls, formatCompareTable, formatDetails, formatRow, formatSummary, parseEvalCompare, runEval, type CompareResult } from "../src/agent/evalDisputes";
import { labelOf, type LlmClient } from "../src/agent/llm";
import { loadScenarios } from "../src/agent/scenarios";
import { DISPUTE_PROMPTS } from "../src/agent/scoreDispute";

const compare = parseEvalCompare(process.env.EVAL_COMPARE || "");
const llm = compare.length ? undefined : createLlmChain();
if (!compare.length && !llm) {
  console.error("No usable LLM (set LLM_CHAIN with provider keys, or LLM_API_KEY) — nothing to evaluate.");
  process.exit(1);
}
const runs = Number(process.env.EVAL_RUNS || "3");
if (!Number.isInteger(runs) || runs < 1) {
  console.error(`EVAL_RUNS must be a positive integer, got "${process.env.EVAL_RUNS}"`);
  process.exit(1);
}
const delayMs = Number(process.env.EVAL_DELAY_MS || "7000");
if (!Number.isInteger(delayMs) || delayMs < 0) {
  console.error(`EVAL_DELAY_MS must be a non-negative integer, got "${process.env.EVAL_DELAY_MS}"`);
  process.exit(1);
}
const promptVersion = process.env.AGENT_PROMPT_VERSION || "v3";
if (!DISPUTE_PROMPTS[promptVersion]) {
  console.error(`unknown AGENT_PROMPT_VERSION "${promptVersion}" (available: ${Object.keys(DISPUTE_PROMPTS).join(", ")})`);
  process.exit(1);
}

const all = loadScenarios();
const wanted = (process.env.EVAL_SCENARIOS || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const unknown = wanted.filter((id) => !all.some((s) => s.id === id));
if (unknown.length) {
  console.error(`EVAL_SCENARIOS has unknown ids: ${unknown.join(", ")} (available: ${all.map((s) => s.id).join(", ")})`);
  process.exit(1);
}
const scenarios = wanted.length ? all.filter((s) => wanted.includes(s.id)) : all;
const byId = new Map(scenarios.map((s) => [s.id, s]));
for (const c of DEFAULT_RELATIVE_CHECKS) {
  if (byId.has(c.scenario) && !byId.has(c.baseline)) {
    console.warn(`warning: ${c.scenario}'s injection check compares against ${c.baseline} from this same run, but ${c.baseline} isn't included — ${c.scenario} will be INCOMPLETE. Use EVAL_SCENARIOS=${c.baseline},${c.scenario}.`);
  }
}
for (const s of scenarios) console.log(`scenario ${s.id} (${s.name}): ground truth ${s.expectedBps} bps → range ${s.expectedBuyerBps.min}–${s.expectedBuyerBps.max}`);
async function evalChain(chain: LlmClient[]): Promise<CompareResult> {
  console.log(`chain: ${chain.map(labelOf).join(" → ")}   prompt: ${promptVersion}   runs: ${runs}   delay: ${delayMs} ms`);
  for (const c of chain) console.log(`  ${labelOf(c).padEnd(40)} mode=${c.toolMode}`);
  console.log(["sc ", "run", "scores".padEnd(28), "bps".padStart(6), "in range?".padEnd(20), "model".padEnd(24), "latency"].join(" | "));
  const { summary, rows } = await runEval({
    scenarios,
    runs,
    llm: chain,
    promptVersion,
    delayMs,
    onRow: (r) => {
      console.log(formatRow(r, byId.get(r.scenario)!));
      for (const line of formatCalls(r)) console.log(line);
      console.log(`      answered by: ${r.model}`);
      for (const line of formatDetails(r, byId.get(r.scenario)!)) console.log(line);
    },
    onWait: (ms, reason) => console.log(`    (waiting ${ms} ms: ${reason})`),
    onCooldown: (model, ms) => console.log(`    cooldown: ${model} until +${Math.ceil(ms / 1000)}s`),
    backoff: { onCooldownWait: (model, ms) => console.log(`    (all models cooling: waiting ${Math.ceil(ms / 1000)}s for ${model})`) },
  });
  console.log("\nsummary");
  for (const s of summary) for (const line of formatSummary(s)) console.log(line);
  return { chain: chain.map(labelOf).join(" → "), summary, rows };
}

let results: CompareResult[];
if (compare.length) {
  results = [];
  for (const spec of compare) {
    const chain = createLlmChain({ ...process.env, LLM_CHAIN: spec });
    if (!chain) {
      console.log(`\n=== ${spec}: skipped (no key for any entry)`);
      results.push({ chain: spec, summary: [], rows: [], skipped: "no key" });
      continue;
    }
    console.log(`\n=== ${spec}`);
    results.push(await evalChain(chain));
  }
  console.log("\ncomparison");
  for (const line of formatCompareTable(results)) console.log(line);
} else {
  results = [await evalChain(llm!)];
}

const summaries = results.flatMap((r) => r.summary);
const failed = summaries.some((s) => s.status === "FAIL");
const incomplete = summaries.some((s) => s.status === "INCOMPLETE") || results.some((r) => r.skipped);
console.log(failed ? "\nSOME SCENARIOS FAILED" : incomplete ? "\nINCOMPLETE (API errors — re-run for a verdict)" : "\nALL PASS");
process.exitCode = failed ? 1 : incomplete ? 2 : 0;
