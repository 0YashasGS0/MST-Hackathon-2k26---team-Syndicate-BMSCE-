// seed:demo logic: one draft per demo scenario, already merged (fixed SOW, no LLM call) and approved by both
// parties, so POST /drafts/:id/approve-sow returns proposeDealArgs immediately. Idempotent (fixed ids "demo-<id>").
// The scored content (title, amount, deliverables, exclusions) is copied verbatim from the scenario file, so the
// ground-truth demo fallback recognises these drafts (demoFingerprint). Parties, token and deadlines are the demo
// wallets and a fresh deadline, so the full sowHash differs from the fixture's placeholders by design.
import { hashSow, parseSow } from "@kernel-exploits/shared";
import type { Scenario } from "../agent/scenarios";
import type { SowStore } from "./store";

export type SeedOptions = {
  buyer: string;
  seller: string;
  token: string;
  reviewWindowSecs: number;
  now: number; // unix seconds; deliveryDeadline = now + 7 days
};

export type SeededDraft = {
  scenario: string;
  draftId: string;
  sowHash: string;
  expectedBps: number; // ground-truth buyerBps (what the fallback / a perfect ruling gives)
  proposeDealArgs: { seller: string; amount: string; sowHash: string; deliverBy: number; reviewPeriod: number };
};

export const demoDraftId = (scenarioId: string) => `demo-${scenarioId}`;

export function seedDemoDrafts(store: SowStore, scenarios: Scenario[], o: SeedOptions): SeededDraft[] {
  const buyer = o.buyer.toLowerCase();
  const seller = o.seller.toLowerCase();
  if (buyer === seller) throw new Error("DEMO_BUYER and DEMO_SELLER must differ");
  const deliveryDeadline = o.now + 7 * 86400;

  return scenarios.map((sc) => {
    const id = demoDraftId(sc.id);
    const sow = parseSow({ ...sc.sow, buyer, seller, token: o.token.toLowerCase(), deliveryDeadline, reviewWindowSecs: o.reviewWindowSecs });
    const sowHash = hashSow(sow);
    store.db.transaction(() => {
      store.deleteDraft(id);
      store.createDraft(
        { buyer, seller, purpose: sow.title, buyerConstraints: `Seeded demo scenario ${sc.id} (${sc.name}).`, amount: sow.amount, deliveryDeadline, reviewWindowSecs: sow.reviewWindowSecs },
        o.now,
        id,
      );
      store.setSellerPoints(id, `Seeded demo scenario ${sc.id}: seller agrees to the fixed SOW.`, o.now);
      store.addVersion(id, JSON.stringify(sow), sowHash, [], o.now);
      store.approve(id, 1, "buyer", o.now);
      store.approve(id, 1, "seller", o.now);
      store.setStatus(id, "approved", o.now);
    })();
    return {
      scenario: sc.id,
      draftId: id,
      sowHash,
      expectedBps: sc.expectedBps,
      proposeDealArgs: { seller: sow.seller, amount: sow.amount, sowHash, deliverBy: sow.deliveryDeadline, reviewPeriod: sow.reviewWindowSecs },
    };
  });
}
