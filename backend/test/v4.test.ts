import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { hashJson, hashSow, verifyRuling, type CriteriaScore, type Reasoning } from "@kernel-exploits/shared";
import { formatCompareTable, parseEvalCompare, runEval } from "../src/agent/evalDisputes";
import { STRIPPED_KEYWORDS } from "../src/agent/geminiSchema";
import { geminiToolSchema } from "../src/agent/geminiSchema";
import type { LlmClient, ToolCallRequest } from "../src/agent/llm";
import { openaiToolParameters } from "../src/agent/openaiCompatClient";
import { loadScenarios } from "../src/agent/scenarios";
import { SCORE_TOOL_V4, scoreToolV4For } from "../src/agent/scoreCriteria";
import { DISPUTE_PROMPTS, DisputeScoringError, scoreDispute } from "../src/agent/scoreDispute";
import { createDisputeRouter } from "../src/sow";
import { SowStore } from "../src/sow/store";

const scenarios = loadScenarios();
const A = scenarios.find((s) => s.id === "A")!;
const input = { dealId: 4, sow: A.sow, sowHash: hashSow(A.sow), deliveryHash: "0x" + "aa".repeat(32), evidenceHash: "0x" + "bb".repeat(32), complaint: A.complaint, deliveryNotes: A.deliveryNotes, evidenceNotes: A.evidenceNotes };
const c = (index: number, verdict: string, basis: string, extra: object = {}) => ({ index, verdict, basis, ...extra, rationale: `r${index}`, evidenceRefs: [] });
/** A under v4: D1 admitted by the complaint ("The homepage is fine"), the rest disputed and judged on evidence. */
const v4Truth = () => ({
  scores: [
    { id: "D1", criteria: [c(0, "met", "admission"), c(1, "met", "admission")] },
    { id: "D2", criteria: [c(0, "partial", "evidence", { satisfied: 12, total: 20 }), c(1, "partial", "evidence", { satisfied: 8, total: 12 })] },
    { id: "D3", criteria: [c(0, "not_met", "evidence"), c(1, "met", "undisputed")] },
  ],
});
function mock(...responses: unknown[]) {
  const calls: ToolCallRequest[] = [];
  const client: LlmClient = { model: "mock-v4", provider: "mock", callTool: async (req) => (calls.push(req), responses[Math.min(calls.length - 1, responses.length - 1)]) };
  return { client, calls };
}
const deps = (client: LlmClient, store = new SowStore(":memory:")) => ({ llm: client, store, demoFallback: false, promptVersion: "v4", now: () => 1 });

describe("prompt v4: burden-of-proof bases", () => {
  it("admission: the complaint says the homepage is fine → met/admission accepted; bps = ground truth 2110; basis stored", async () => {
    expect(A.complaint).toMatch(/The homepage is fine/);
    const { client, calls } = mock(v4Truth());
    const store = new SowStore(":memory:");
    const r = await scoreDispute(input, deps(client, store));
    expect(r).toMatchObject({ buyerBps: 2110, promptVersion: "v4" });
    expect(calls[0].system).toBe(DISPUTE_PROMPTS.v4);
    expect(calls[0].system).toMatch(/ADMISSION: if the complaint or the buyer's own statements say/);
    expect(calls[0].system).toMatch(/Missing evidence about an undisputed criterion is NOT a failure/);
    const stored = store.getRuling(r.reasoningHash) as Reasoning;
    expect((stored.scores[0] as CriteriaScore).criteria.map((x) => x.basis)).toEqual(["admission", "admission"]);
    expect(verifyRuling({ reasoning: stored, onchainReasoningHash: r.reasoningHash, onchainProposedBps: 2110, sow: A.sow })).toMatchObject({ ok: true, fulfilledMatches: true });
  });

  it("not_met with basis admission → validation error → retry with the error → succeeds when fixed", async () => {
    const bad = v4Truth();
    bad.scores[0].criteria[0] = c(0, "not_met", "admission");
    const { client, calls } = mock(bad, v4Truth());
    const r = await scoreDispute(input, deps(client));
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toMatch(/scores\.D1: criterion 0: basis "admission" requires verdict "met" \(got "not_met"\)/);
    expect(r.buyerBps).toBe(2110);
  });

  it("undisputed + met is valid; undisputed + not_met is invalid (retry, then error)", async () => {
    const ok = v4Truth();
    ok.scores[0].criteria = [c(0, "met", "undisputed"), c(1, "met", "undisputed")];
    expect((await scoreDispute(input, deps(mock(ok).client))).buyerBps).toBe(2110);

    const bad = v4Truth();
    bad.scores[0].criteria[1] = c(1, "not_met", "undisputed");
    const { client, calls } = mock(bad);
    const err = await scoreDispute(input, deps(client)).catch((e) => e);
    expect(err).toBeInstanceOf(DisputeScoringError);
    expect(err.issues).toEqual(['scores.D1: criterion 1: basis "undisputed" requires verdict "met" (got "not_met")']);
    expect(calls).toHaveLength(2);
  });

  it("the evidence basis allows any verdict; a missing basis is rejected under v4", async () => {
    const anyVerdict = v4Truth();
    anyVerdict.scores[0].criteria = [c(0, "not_met", "evidence"), c(1, "partial", "evidence", { satisfied: 1, total: 2 })];
    const r = await scoreDispute(input, deps(mock(anyVerdict).client));
    expect(r.scores[0].fulfilledPct).toBe(25); // floor((0 + 50) / 2)

    const noBasis = v4Truth() as { scores: { id: string; criteria: Record<string, unknown>[] }[] };
    delete noBasis.scores[1].criteria[0].basis;
    const err = await scoreDispute(input, deps(mock(noBasis).client)).catch((e) => e);
    expect(err).toBeInstanceOf(DisputeScoringError);
    expect(err.issues.join(" ")).toMatch(/basis/);
  });

  it("v3 rulings still work and verify (no basis)", async () => {
    const v3 = v4Truth() as { scores: { id: string; criteria: Record<string, unknown>[] }[] };
    for (const s of v3.scores) for (const x of s.criteria) delete x.basis;
    const store = new SowStore(":memory:");
    const r = await scoreDispute(input, { ...deps(mock(v3).client, store), promptVersion: "v3" });
    const stored = store.getRuling(r.reasoningHash) as Reasoning;
    expect("basis" in (stored.scores[0] as CriteriaScore).criteria[0]).toBe(false);
    expect(verifyRuling({ reasoning: stored, onchainReasoningHash: hashJson(stored), sow: A.sow })).toMatchObject({ ok: true });
  });
});

describe("v4 schemas", () => {
  it("sanitized schemas (Gemini + OpenAI-compatible) keep the basis enum and require it; Anthropic gets the full schema", () => {
    const tool = scoreToolV4For(A.sow);
    const gem = geminiToolSchema(tool);
    const item = gem.properties!.scores.items!.properties!.criteria.items!;
    expect(item.properties!.basis.enum).toEqual(["admission", "undisputed", "evidence"]);
    expect(item.required).toEqual(["index", "verdict", "basis", "rationale", "evidenceRefs"]);
    const oa = JSON.stringify(openaiToolParameters(tool));
    for (const k of STRIPPED_KEYWORDS) expect(oa).not.toContain(`"${k}"`);
    expect(oa).toContain('"enum":["admission","undisputed","evidence"]');
    expect(JSON.stringify(SCORE_TOOL_V4.input_schema)).toContain('"minimum":0'); // full schema for Anthropic
  });
});

describe("/deals/:id/verify includes basis per criterion", () => {
  it("returns a flat resolution list with criterion text and basis badges", async () => {
    const store = new SowStore(":memory:");
    const d = store.createDraft({ buyer: A.sow.buyer, seller: A.sow.seller, purpose: "p", buyerConstraints: "c", amount: A.sow.amount, deliveryDeadline: A.sow.deliveryDeadline, reviewWindowSecs: A.sow.reviewWindowSecs }, 1);
    store.addVersion(d.id, JSON.stringify(A.sow), hashSow(A.sow), [], 1);
    store.setStatus(d.id, "approved", 1);
    store.link(d.id, 4, "0x" + "ab".repeat(32), 1);
    const r = await scoreDispute(input, deps(mock(v4Truth()).client, store));
    const app = express();
    app.use(createDisputeRouter({ store, readDeal: async () => ({ reasoningHash: r.reasoningHash as `0x${string}`, proposedBuyerBps: r.buyerBps, status: 6 }) }));
    const res = await request(app).get("/deals/4/verify").expect(200);
    expect(res.body.result.ok).toBe(true);
    expect(res.body.resolution).toHaveLength(6);
    expect(res.body.resolution[0]).toEqual({ deliverableId: "D1", index: 0, criterion: "Renders correctly at 375px and 1440px widths", verdict: "met", basis: "admission", rationale: "r0", evidenceRefs: [] });
    expect(res.body.resolution[2]).toMatchObject({ deliverableId: "D2", verdict: "partial", satisfied: 12, total: 20, basis: "evidence" });
  });
});

describe("cross-model eval (EVAL_COMPARE)", () => {
  it("parses entries, reports basis mix, and prints a side-by-side table", async () => {
    expect(parseEvalCompare("groq:openai/gpt-oss-120b; gemini:gemini-2.5-flash")).toEqual(["groq:openai/gpt-oss-120b", "gemini:gemini-2.5-flash"]);
    const strict = v4Truth();
    strict.scores[0].criteria = [c(0, "not_met", "evidence"), c(1, "not_met", "evidence")]; // the D1=0 failure mode
    const groq = Object.assign(mock(strict).client, { id: "groq:openai/gpt-oss-120b" });
    const gemini = Object.assign(mock(v4Truth()).client, { id: "gemini:gemini-2.5-flash" });
    const results = [];
    for (const llm of [groq, gemini]) {
      const { rows, summary } = await runEval({ scenarios: [A], runs: 1, llm, promptVersion: "v4", sleep: async () => {} });
      results.push({ chain: llm.id, rows, summary });
    }
    expect(results[1].summary[0].basisMix).toEqual({ admission: 2, undisputed: 1, evidence: 3 });
    const table = formatCompareTable(results);
    expect(table[0]).toMatch(/^scenario +\| model +\| bps \(median; runs\) +\| in range +\| agreement +\| basis mix$/);
    expect(table[2]).toMatch(/^A partial delivery +\| groq:openai\/gpt-oss-120b +\| 7110 \(7110\) +\| FAIL +\| 4\/6 +\| admission 0 · undisputed 1 · evidence 5$/);
    expect(table[3]).toMatch(/^A partial delivery +\| gemini:gemini-2.5-flash +\| 2110 \(2110\) +\| PASS +\| 6\/6 +\| admission 2 · undisputed 1 · evidence 3$/);
  });
});
