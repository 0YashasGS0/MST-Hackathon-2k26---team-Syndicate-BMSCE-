// One real SOW merge against the configured LLM provider.
// Usage: npm run smoke:merge   (LLM_PROVIDER, LLM_API_KEY, LLM_MODEL from backend/.env or repo-root .env)
import "./_env";
import { hashSow } from "@kernel-exploits/shared";
import { promptVersionBanner, resolveScriptChain } from "../src/agent/scriptEnv";
import { mergeSow, SowMergeError } from "../src/agent/mergeSow";
import { SAMPLE_PARTIES, attemptRecorder, sampleToken } from "./_env";

const banner = promptVersionBanner(process.env);
console.log(`${banner.line} — dispute scoring; the SOW merge prompt is sow-merge/v1`);
if (banner.warning) console.warn(banner.warning);
const resolved = resolveScriptChain(process.env);
if ("error" in resolved) {
  console.error(resolved.error);
  process.exit(1);
}
const llm = resolved.chain;
const token = sampleToken();
const now = Math.floor(Date.now() / 1000);
const input = {
  ...SAMPLE_PARTIES,
  purpose: "Landing page for my bakery, Crumb & Co.",
  buyerConstraints:
    "Needs a mobile-friendly homepage with our story and opening hours, a menu page listing our 20 products with prices, and a contact form that emails me. Delivery within 7 days.",
  sellerPoints:
    "Happy to do homepage, menu and contact form. Hosting and logo design are not included. I would prefer 10 days rather than 7, and I'll need the menu content from the buyer by day 2.",
  amount: "100000000", // 100 mUSD
  deliveryDeadline: now + 7 * 86400,
  reviewWindowSecs: 2 * 86400,
};

const rec = attemptRecorder(llm);
rec.header();
const started = Date.now();
try {
  const result = await mergeSow(input, { llm, token, demoFallback: false, onCall: rec.onAttempt, backoff: rec.backoff });
  rec.print();
  console.log("validation: PASSED");
  console.log(`result.model: ${result.model}`);
  console.log(`title: ${result.sow.title}`);
  for (const d of result.sow.deliverables) console.log(`  ${d.id.padEnd(4)} ${String(d.weightBps).padStart(5)} bps  ${d.title}`);
  console.log(`  sum  ${result.sow.deliverables.reduce((s, d) => s + d.weightBps, 0)} bps`);
  console.log(`exclusions: ${result.sow.exclusions.join("; ") || "(none)"}`);
  console.log(`conflicts: ${result.conflicts.length}`);
  for (const c of result.conflicts) console.log(`  - ${c}`);
  console.log(`sowHash: ${hashSow(result.sow)}`);
} catch (err) {
  rec.print();
  if (err instanceof SowMergeError) {
    console.log("validation: FAILED after the retry");
    for (const i of err.issues) console.log(`  - ${i}`);
  } else {
    console.log(`error: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
  process.exitCode = 1;
} finally {
  console.log(`total latency: ${Date.now() - started} ms`);
}
