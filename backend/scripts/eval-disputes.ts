// Runs every demo scenario EVAL_RUNS times (default 3) through the real scoreDispute with the configured
// provider/model/fallbacks and AGENT_PROMPT_VERSION. EVAL_DELAY_MS (default 7000) between calls, longer after a
// 429 that carries a retryDelay (capped at 30 s). Never prints the key or prompts.
// Usage: npm run eval:disputes      (compare prompts: AGENT_PROMPT_VERSION=v2 npm run eval:disputes)
import "./_env";
import { createLlmChain } from "../src/agent/createLlmClient";
import { formatRationales, formatRow, formatSummary, runEval } from "../src/agent/evalDisputes";
import { loadScenarios } from "../src/agent/scenarios";
import { DISPUTE_PROMPTS } from "../src/agent/scoreDispute";

const llm = createLlmChain();
if (!llm) {
  console.error("LLM_API_KEY is not set in .env — nothing to evaluate.");
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
const promptVersion = process.env.AGENT_PROMPT_VERSION || "v1";
if (!DISPUTE_PROMPTS[promptVersion]) {
  console.error(`unknown AGENT_PROMPT_VERSION "${promptVersion}" (available: ${Object.keys(DISPUTE_PROMPTS).join(", ")})`);
  process.exit(1);
}

const scenarios = loadScenarios();
const byId = new Map(scenarios.map((s) => [s.id, s]));
console.log(`provider: ${llm[0].provider}   models: ${llm.map((c) => c.model).join(" → ")}   prompt: ${promptVersion}   runs: ${runs}   delay: ${delayMs} ms`);
console.log(["sc ", "run", "scores".padEnd(28), "bps".padStart(6), "in range?".padEnd(20), "model".padEnd(24), "latency"].join(" | "));

const { summary } = await runEval({
  scenarios,
  runs,
  llm,
  promptVersion,
  delayMs,
  onRow: (r) => {
    console.log(formatRow(r, byId.get(r.scenario)!));
    for (const line of formatRationales(r)) console.log(line);
  },
  onWait: (ms, reason) => console.log(`    (waiting ${ms} ms: ${reason})`),
});

console.log("\nsummary");
for (const s of summary) for (const line of formatSummary(s)) console.log(line);
const failed = summary.some((s) => s.status === "FAIL");
const incomplete = summary.some((s) => s.status === "INCOMPLETE");
console.log(failed ? "\nSOME SCENARIOS FAILED" : incomplete ? "\nINCOMPLETE (API errors — re-run for a verdict)" : "\nALL PASS");
process.exitCode = failed ? 1 : incomplete ? 2 : 0;
