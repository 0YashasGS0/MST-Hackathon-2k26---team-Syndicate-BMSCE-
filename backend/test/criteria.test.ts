import { describe, expect, it } from "vitest";
import { hashJson, hashSow, verifyRuling, type CriteriaScore, type Reasoning } from "@kernel-exploits/shared";
import { formatDetails, runEval } from "../src/agent/evalDisputes";
import { GeminiLlmClient, type GeminiModelsApi } from "../src/agent/geminiClient";
import { STRIPPED_KEYWORDS, geminiToolSchema } from "../src/agent/geminiSchema";
import type { LlmClient, ToolCallRequest } from "../src/agent/llm";
import { loadScenarios } from "../src/agent/scenarios";
import { SCORE_TOOL_V3, scoreToolV3For } from "../src/agent/scoreCriteria";
import { DISPUTE_PROMPTS, DisputeScoringError, scoreDispute } from "../src/agent/scoreDispute";
import { SowStore } from "../src/sow/store";

const scenarios = loadScenarios();
const A = scenarios.find((s) => s.id === "A")!;
const sow = A.sow;
const input = {
  dealId: 5, sow, sowHash: hashSow(sow), deliveryHash: "0x" + "aa".repeat(32), evidenceHash: "0x" + "bb".repeat(32),
  complaint: A.complaint, deliveryNotes: A.deliveryNotes, evidenceNotes: A.evidenceNotes,
};
const c = (index: number, verdict: string, extra: object = {}) => ({ index, verdict, ...extra, rationale: `why c${index}`, evidenceRefs: ["E1"] });
/** A's ground truth as model output: D1 met/met, D2 12/20 & 8/12, D3 not_met/met. */
const truthOutput = () => ({
  scores: [
    { id: "D1", criteria: [c(0, "met"), c(1, "met")] },
    { id: "D2", criteria: [c(0, "partial", { satisfied: 12, total: 20 }), c(1, "partial", { satisfied: 8, total: 12 })] },
    { id: "D3", criteria: [c(0, "not_met"), c(1, "met")] },
  ],
});

function mock(...responses: unknown[]) {
  const calls: ToolCallRequest[] = [];
  const client: LlmClient = {
    model: "mock-v3",
    provider: "mock",
    callTool: async (req) => {
      calls.push(req);
      return responses[Math.min(calls.length - 1, responses.length - 1)];
    },
  };
  return { client, calls };
}
const deps = (client: LlmClient, store = new SowStore(":memory:")) => ({ llm: client, store, demoFallback: false, promptVersion: "v3", now: () => 1 });

describe("prompt v3: verdicts from the LLM, percentages from code", () => {
  it("computes fulfilledPct per deliverable (100 / 63 / 50) and buyerBps 2110 = A's ground truth", async () => {
    const { client, calls } = mock(truthOutput());
    const store = new SowStore(":memory:");
    const r = await scoreDispute(input, deps(client, store));
    expect(r.scores.map((s) => s.fulfilledPct)).toEqual([100, 63, 50]);
    expect(r.buyerBps).toBe(2110);
    expect(r.buyerBps).toBe(A.expectedBps);
    expect(calls[0].system).toBe(DISPUTE_PROMPTS.v3);
    expect(calls[0].tool.name).toBe("submit_scores");
    expect(calls[0].prompt).toContain('"index": 1,\n          "text": "Every item shows its price"');
    // the stored reasoning holds the verdicts and verifies, including fulfilledMatches
    const stored = store.getRuling(r.reasoningHash) as Reasoning;
    expect((stored.scores[1] as CriteriaScore).criteria[0]).toEqual({ index: 0, verdict: "partial", satisfied: 12, total: 20, rationale: "why c0", evidenceRefs: ["E1"] });
    expect(verifyRuling({ reasoning: stored, onchainReasoningHash: r.reasoningHash, onchainProposedBps: 2110, sow })).toMatchObject({ ok: true, fulfilledMatches: true });
  });

  it("an LLM that outputs fulfilledPct is rejected (retry, then error)", async () => {
    const bad = truthOutput();
    (bad.scores[1] as Record<string, unknown>).fulfilledPct = 90;
    const { client, calls } = mock(bad);
    const err = await scoreDispute(input, deps(client)).catch((e) => e);
    expect(err).toBeInstanceOf(DisputeScoringError);
    expect(err.issues).toEqual(["scores.1.fulfilledPct: must not be output; the code computes it from the criteria verdicts"]);
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toMatch(/failed validation[\s\S]*fulfilledPct: must not be output/);
  });

  it("a missing criterion index → retry → succeeds when fixed", async () => {
    const missing = truthOutput();
    missing.scores[2].criteria.pop();
    const { client, calls } = mock(missing, truthOutput());
    const r = await scoreDispute(input, deps(client));
    expect(calls).toHaveLength(2);
    expect(calls[1].prompt).toMatch(/scores\.D3: missing verdict for criterion index 1/);
    expect(r.buyerBps).toBe(2110);
  });

  it("a duplicate criterion index → retry → error if repeated", async () => {
    const dup = truthOutput();
    dup.scores[0].criteria[1] = c(0, "met");
    const { client, calls } = mock(dup);
    const err = await scoreDispute(input, deps(client)).catch((e) => e);
    expect(err).toBeInstanceOf(DisputeScoringError);
    expect(err.issues).toEqual(["scores.D1: criterion index 0 appears more than once"]);
    expect(calls).toHaveLength(2);
  });

  it("partial without counts, and counts out of bounds, are rejected", async () => {
    const noCounts = truthOutput();
    noCounts.scores[1].criteria[0] = c(0, "partial");
    let err = await scoreDispute(input, deps(mock(noCounts).client)).catch((e) => e);
    expect(err.issues).toEqual(['scores.D2: criterion 0: "partial" needs integer satisfied and total']);

    const over = truthOutput();
    over.scores[1].criteria[0] = c(0, "partial", { satisfied: 21, total: 20 });
    err = await scoreDispute(input, deps(mock(over).client)).catch((e) => e);
    expect(err.issues).toEqual(["scores.D2: criterion 0: satisfied must be between 0 and total"]);
  });

  it("v2 rulings keep their old shape and still verify", async () => {
    const v2 = { scores: [{ id: "D1", fulfilledPct: 100, rationale: "r", evidenceRefs: [] }, { id: "D2", fulfilledPct: 63, rationale: "r", evidenceRefs: [] }, { id: "D3", fulfilledPct: 50, rationale: "r", evidenceRefs: [] }] };
    const store = new SowStore(":memory:");
    const r = await scoreDispute(input, { ...deps(mock(v2).client, store), promptVersion: "v2" });
    const stored = store.getRuling(r.reasoningHash) as Reasoning;
    expect(stored.scores[0]).toEqual({ id: "D1", fulfilledPct: 100, rationale: "r", evidenceRefs: [] });
    expect(hashJson(stored)).toBe(r.reasoningHash);
    expect(verifyRuling({ reasoning: stored, onchainReasoningHash: r.reasoningHash, sow })).toMatchObject({ ok: true, fulfilledMatches: null });
  });
});

describe("v3 tool schema", () => {
  it("Gemini: sanitized, verdict enum kept, and descriptions list each deliverable's criteria by index and text", async () => {
    const schema = geminiToolSchema(scoreToolV3For(sow));
    const json = JSON.stringify(schema);
    for (const k of STRIPPED_KEYWORDS) expect(json).not.toContain(`"${k}"`);
    const criteria = schema.properties!.scores.items!.properties!.criteria;
    expect(criteria.description).toContain('D2: 0 = "All 20 menu items are listed", 1 = "Every item shows its price"');
    expect(criteria.description).toContain('D3: 0 = "Submitting the form delivers an email to the owner\'s inbox"');
    expect(schema.properties!.scores.description).toContain("Exactly one entry per deliverable id: D1, D2, D3.");
    expect(criteria.items!.properties!.verdict.enum).toEqual(["met", "partial", "not_met"]);
    expect(criteria.items!.required).toEqual(["index", "verdict", "rationale", "evidenceRefs"]);

    // and the Gemini client actually sends it for a v3 scoring call
    const sent: unknown[] = [];
    const models: GeminiModelsApi = {
      generateContent: async (p) => {
        sent.push((p.config?.tools as { functionDeclarations: { parameters: unknown }[] }[])[0].functionDeclarations[0].parameters);
        return { functionCalls: [{ name: "submit_scores", args: truthOutput() }], candidates: [{ finishReason: "STOP" as never }], promptFeedback: undefined };
      },
    };
    const r = await scoreDispute(input, deps(new GeminiLlmClient("gemini-test", "k", models)));
    expect(r.buyerBps).toBe(2110);
    expect(sent[0]).toEqual(schema);
  });

  it("Anthropic keeps the full JSON Schema (bounds included)", () => {
    expect(JSON.stringify(SCORE_TOOL_V3.input_schema)).toContain('"minimum":0');
    expect(JSON.stringify(SCORE_TOOL_V3.input_schema)).toContain('"additionalProperties":false');
  });
});

describe("eval with v3: agreement and diagnostics", () => {
  it("reports per-criterion agreement with ground truth", async () => {
    const off = truthOutput();
    off.scores[1].criteria[0] = c(0, "partial", { satisfied: 10, total: 20 }); // counts differ from truth → disagreement
    const { client } = mock(truthOutput(), off);
    const { rows, summary } = await runEval({ scenarios: [A], runs: 2, llm: client, promptVersion: "v3", sleep: async () => {} });
    expect(rows.map((r) => r.agreement)).toEqual([{ agree: 6, total: 6 }, { agree: 5, total: 6 }]);
    expect(summary[0].agreement).toEqual({ agree: 11, total: 12 });
  });

  it("out-of-range and INVALID runs print verdicts vs ground truth, and each attempt's model + errors", async () => {
    const wrong = truthOutput();
    wrong.scores[2].criteria[1] = c(1, "not_met"); // D3 → 0 → buyerBps 3110, out of range
    const invalid = truthOutput();
    (invalid.scores[0] as Record<string, unknown>).fulfilledPct = 100;
    const { client } = mock(wrong, invalid);
    const { rows } = await runEval({ scenarios: [A], runs: 2, llm: client, promptVersion: "v3", sleep: async () => {} });

    expect(rows[0]).toMatchObject({ status: "fail", buyerBps: 3110 });
    const out = formatDetails(rows[0], A);
    expect(out).toHaveLength(6);
    expect(out[3]).toMatch(/D2 c1 partial 8\/12 +\[truth: partial 8\/12 ✓\] +why c1/);
    expect(out[5]).toMatch(/D3 c1 not_met +\[truth: met ✗\] +why c1/);

    expect(rows[1]).toMatchObject({ status: "fail", buyerBps: null });
    const inv = formatDetails(rows[1], A);
    expect(inv[0]).toBe("      attempt 1 (mock-v3): scores.0.fulfilledPct: must not be output; the code computes it from the criteria verdicts");
    expect(inv[1]).toMatch(/^ {6}attempt 2 \(mock-v3\): /);
    expect(inv.slice(2).some((l) => /D2 c0 partial 12\/20 +\[truth: partial 12\/20 ✓\]/.test(l))).toBe(true); // last raw output's verdicts
  });

  it("truncates attempt errors to 300 chars", async () => {
    const huge = { scores: [{ id: "X".repeat(400), criteria: [] }] };
    const { rows } = await runEval({ scenarios: [A], runs: 1, llm: mock(huge).client, promptVersion: "v3", sleep: async () => {} });
    const line = formatDetails(rows[0], A)[0];
    expect(line.replace(/^ {6}attempt 1 \(mock-v3\): /, "")).toHaveLength(300);
  });
});
