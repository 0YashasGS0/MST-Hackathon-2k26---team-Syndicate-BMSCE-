// Seeds demo drafts for scenarios A–D: fixed SOW, merged (no LLM) and approved by both parties.
// Env: DEMO_BUYER, DEMO_SELLER, USD_ADDRESS (required); DEMO_REVIEW_SECS (default 120); DB_PATH.
// Idempotent: re-running resets the demo-* drafts. Usage: npm run seed:demo
import "./_env";
import { loadScenarios } from "../src/agent/scenarios";
import { seedDemoDrafts } from "../src/sow/demoSeed";
import { SowStore } from "../src/sow/store";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
function need(name: string): string {
  const v = process.env[name];
  if (!v || !ADDRESS.test(v)) {
    console.error(`${name} must be set to a 0x address in .env`);
    process.exit(1);
  }
  return v;
}
const buyer = need("DEMO_BUYER");
const seller = need("DEMO_SELLER");
const token = need("USD_ADDRESS");
const reviewWindowSecs = Number(process.env.DEMO_REVIEW_SECS || "120");
if (!Number.isInteger(reviewWindowSecs) || reviewWindowSecs <= 0) {
  console.error(`DEMO_REVIEW_SECS must be a positive integer, got "${process.env.DEMO_REVIEW_SECS}"`);
  process.exit(1);
}

const store = new SowStore(); // DB_PATH or ./data/app.sqlite
const seeded = seedDemoDrafts(store, loadScenarios(), { buyer, seller, token, reviewWindowSecs, now: Math.floor(Date.now() / 1000) });
console.log(`seeded ${seeded.length} demo drafts into ${process.env.DB_PATH || "./data/app.sqlite"} (buyer ${buyer.toLowerCase()}, seller ${seller.toLowerCase()})\n`);
for (const s of seeded) {
  console.log(`scenario ${s.scenario}  draftId=${s.draftId}`);
  console.log(`  sowHash:         ${s.sowHash}`);
  console.log(`  proposeDealArgs: ${JSON.stringify(s.proposeDealArgs)}`);
}
