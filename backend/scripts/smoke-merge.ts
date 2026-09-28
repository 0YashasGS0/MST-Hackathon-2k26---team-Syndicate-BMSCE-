// One real SOW merge against the LLM API, to confirm the model accepts our tool setup.
// Usage: npm run smoke:merge   (reads LLM_API_KEY / LLM_MODEL / USD_ADDRESS from ../.env or ./.env)
// Prints only metadata and the resulting weights/hash — never the key, request headers or the prompt.
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { hashSow } from "@kernel-exploits/shared";
import { AnthropicLlmClient, type LlmCallInfo } from "../src/agent/llm";
import { mergeSow, SowMergeError } from "../src/agent/mergeSow";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: [resolve(here, "../.env"), resolve(here, "../../.env")], quiet: true });

const key = process.env.LLM_API_KEY;
if (!key) {
  console.error("LLM_API_KEY is not set in .env — nothing to test.");
  process.exit(1);
}
const model = process.env.LLM_MODEL || "claude-sonnet-5";
const envUsd = process.env.USD_ADDRESS ?? "";
const token = /^0x[0-9a-fA-F]{40}$/.test(envUsd) ? envUsd.toLowerCase() : "0x0000000000000000000000000000000000000001";

const now = Math.floor(Date.now() / 1000);
const input = {
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  purpose: "Landing page for my bakery, Crumb & Co.",
  buyerConstraints:
    "Needs a mobile-friendly homepage with our story and opening hours, a menu page listing our 20 products with prices, and a contact form that emails me. Delivery within 7 days.",
  sellerPoints:
    "Happy to do homepage, menu and contact form. Hosting and logo design are not included. I would prefer 10 days rather than 7, and I'll need the menu content from the buyer by day 2.",
  amount: "100000000", // 100 mUSD
  deliveryDeadline: now + 7 * 86400,
  reviewWindowSecs: 2 * 86400,
};

const llm = new AnthropicLlmClient(model, key);
const attempts: (LlmCallInfo & { attempt: number; outcome: string })[] = [];

console.log(`model:            ${model}`);
console.log(`token:            ${token}${token === envUsd.toLowerCase() ? "" : " (placeholder: USD_ADDRESS not set)"}`);
const started = Date.now();
try {
  const result = await mergeSow(input, {
    llm,
    token,
    demoFallback: false,
    onCall: (a) => {
      const info = llm.lastCall;
      llm.lastCall = undefined;
      attempts.push({
        attempt: a.attempt,
        forcedToolChoice: info?.forcedToolChoice ?? false,
        toolCalled: info?.toolCalled ?? false,
        stopReason: info?.stopReason ?? "(no response)",
        latencyMs: info?.latencyMs ?? 0,
        outcome: a.error ? `failed: ${a.error.slice(0, 200)}` : "valid",
      });
    },
  });
  report();
  console.log(`validation:       PASSED after ${attempts.length} attempt(s)`);
  console.log(`title:            ${result.sow.title}`);
  for (const d of result.sow.deliverables) console.log(`  ${d.id.padEnd(4)} ${String(d.weightBps).padStart(5)} bps  ${d.title}`);
  console.log(`  sum  ${result.sow.deliverables.reduce((s, d) => s + d.weightBps, 0)} bps`);
  console.log(`exclusions:       ${result.sow.exclusions.join("; ") || "(none)"}`);
  console.log(`conflicts:        ${result.conflicts.length}`);
  for (const c of result.conflicts) console.log(`  - ${c}`);
  console.log(`sowHash:          ${hashSow(result.sow)}`);
} catch (err) {
  report();
  if (err instanceof SowMergeError) {
    console.log(`validation:       FAILED after ${attempts.length} attempt(s)`);
    for (const i of err.issues) console.log(`  - ${i}`);
  } else {
    console.log(`error:            ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
  process.exitCode = 1;
} finally {
  console.log(`total latency:    ${Date.now() - started} ms`);
}

function report() {
  for (const a of attempts) {
    const honoured = a.forcedToolChoice ? (a.toolCalled ? "yes" : "NO") : `n/a (auto mode; tool called: ${a.toolCalled ? "yes" : "no"})`;
    console.log(`attempt ${a.attempt}:        forced tool call honoured: ${honoured}; stop_reason=${a.stopReason}; ${a.latencyMs} ms; ${a.outcome}`);
  }
}
