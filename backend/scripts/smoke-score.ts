// One real dispute scoring (partial delivery) against the configured LLM provider. Uses an in-memory DB.
// Usage: npm run smoke:score
import "./_env";
import { hasCriteria, hashSow, parseSow } from "@kernel-exploits/shared";
import { createLlmChain } from "../src/agent/createLlmClient";
import { DisputeScoringError, scoreDispute } from "../src/agent/scoreDispute";
import { SowStore } from "../src/sow/store";
import { SAMPLE_PARTIES, attemptRecorder, sampleToken } from "./_env";

const llm = createLlmChain();
if (!llm) {
  console.error("LLM_API_KEY is not set in .env — nothing to test.");
  process.exit(1);
}

const sow = parseSow({
  version: "sow/v1",
  title: "Landing page for Crumb & Co. bakery",
  ...SAMPLE_PARTIES,
  token: sampleToken(),
  amount: "100000000",
  deliveryDeadline: Math.floor(Date.now() / 1000) + 7 * 86400,
  reviewWindowSecs: 2 * 86400,
  deliverables: [
    { id: "D1", title: "Responsive homepage", description: "Homepage with story and opening hours", acceptanceCriteria: ["Renders correctly at 375px and 1440px", "Shows opening hours"], weightBps: 5000 },
    { id: "D2", title: "Menu page", description: "All products with prices", acceptanceCriteria: ["All 20 menu items listed with name and price"], weightBps: 3000 },
    { id: "D3", title: "Contact form", description: "Form that emails the owner", acceptanceCriteria: ["Submitting the form delivers an email to the owner"], weightBps: 2000 },
  ],
  exclusions: ["Hosting costs", "Logo design"],
});

const store = new SowStore(":memory:");
// Real agent_calls logging goes to the in-memory store; the recorder only reads call metadata.
const rec = attemptRecorder(llm);
const origLog = store.logAgentCall.bind(store);
store.logAgentCall = (call, now) => {
  rec.onAttempt(call);
  origLog(call, now);
};

rec.header();
const started = Date.now();
try {
  const r = await scoreDispute(
    {
      dealId: 1,
      sow,
      sowHash: hashSow(sow),
      deliveryHash: "0x" + "aa".repeat(32),
      evidenceHash: "0x" + "bb".repeat(32),
      deliveryNotes: "Seller delivered: homepage (live link), menu page, contact form.",
      complaint:
        "The homepage is fine. The menu page only lists 12 of our 20 products and several prices are missing. The contact form submits but no email ever arrives.",
      evidenceNotes:
        "menu-screenshot.png: menu page shows 12 items, 4 without prices. form-test.mp4: form submitted at 10:02, owner inbox empty after 1 hour. homepage-mobile.png: homepage renders correctly on a phone.",
    },
    { llm, store, demoFallback: false, promptVersion: process.env.AGENT_PROMPT_VERSION || "v1", backoff: rec.backoff },
  );
  rec.print();
  console.log("validation: PASSED");
  for (const s of r.scores) {
    if (!hasCriteria(s)) {
      console.log(`  ${s.id.padEnd(4)} ${String(s.fulfilledPct).padStart(3)}%  ${s.rationale.slice(0, 140)}  [${s.evidenceRefs.join(", ")}]`);
      continue;
    }
    console.log(`  ${s.id.padEnd(4)} ${String(s.fulfilledPct).padStart(3)}%  (computed from ${s.criteria.length} criterion verdicts)`);
    for (const c of s.criteria) {
      const v = c.verdict === "partial" ? `partial ${c.satisfied}/${c.total}` : c.verdict;
      console.log(`       c${c.index} ${v.padEnd(14)} ${c.rationale.slice(0, 120)}  [${c.evidenceRefs.join(", ")}]`);
    }
  }
  console.log(`model in reasoningHash: ${r.model}`);
  console.log(`buyerBps: ${r.buyerBps} (buyer refund ${(r.buyerBps / 100).toFixed(2)}%)`);
  console.log(`reasoningHash: ${r.reasoningHash}`);
} catch (err) {
  rec.print();
  if (err instanceof DisputeScoringError) {
    console.log("validation: FAILED after the retry");
    for (const i of err.issues) console.log(`  - ${i}`);
  } else {
    console.log(`error: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
  }
  process.exitCode = 1;
} finally {
  console.log(`total latency: ${Date.now() - started} ms`);
}
