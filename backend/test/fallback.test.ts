import { describe, expect, it } from "vitest";
import { ApiError } from "@google/genai";
import { hashSow, verifyRuling, type CriteriaScore, type Reasoning, type Sow } from "@kernel-exploits/shared";
import { scoreDispute as scoreDisputeFromIndex } from "../src/agent";
import { demoFingerprint, findDemoScenario } from "../src/agent/demoFallback";
import { GeminiLlmClient, type GeminiModelsApi } from "../src/agent/geminiClient";
import type { LlmClient } from "../src/agent/llm";
import { ModelCooldowns } from "../src/agent/resilience";
import { loadScenarios } from "../src/agent/scenarios";
import { DemoFallbackError, DisputeScoringError, LlmUnavailableError, scoreDispute } from "../src/agent/scoreDispute";
import { seedDemoDrafts } from "../src/sow/demoSeed";
import { SowStore } from "../src/sow/store";

const scenarios = loadScenarios();
const byId = Object.fromEntries(scenarios.map((s) => [s.id, s]));
const inputFor = (sow: Sow, dealId = 1) => ({
  dealId, sow, sowHash: hashSow(sow), deliveryHash: "0x" + "aa".repeat(32), evidenceHash: "0x" + "bb".repeat(32),
  complaint: "c", deliveryNotes: "d", evidenceNotes: "e",
});
const noLlm = { store: new SowStore(":memory:"), now: () => 1 };

describe("ground-truth demo fallback (AGENT_DEMO_FALLBACK)", () => {
  it("each scenario's fallback ruling equals its ground-truth bps, through the v3 path; A = 2110; D = A", async () => {
    const bps: Record<string, number> = {};
    for (const sc of scenarios) {
      const r = await scoreDispute(inputFor(sc.sow), { ...noLlm, store: new SowStore(":memory:"), demoFallback: true });
      bps[sc.id] = r.buyerBps;
      expect(r.buyerBps).toBe(sc.expectedBps);
      expect(r.model).toBe("demo-fallback");
      expect(r.promptVersion).toBe("v3");
      expect((r.scores[0] as CriteriaScore).criteria).toBeDefined();
    }
    expect(bps).toEqual({ A: 2110, B: 0, C: 8000, D: 2110 });
  });

  it("a fallback ruling verifies (hash, formula, per-criterion fulfilledPct, SOW)", async () => {
    const store = new SowStore(":memory:");
    const r = await scoreDispute(inputFor(byId.A.sow, 9), { ...noLlm, store, demoFallback: true });
    const stored = store.getRuling(r.reasoningHash) as Reasoning;
    expect(stored.model).toBe("demo-fallback");
    expect((stored.scores[1] as CriteriaScore).criteria[0]).toMatchObject({ index: 0, verdict: "partial", satisfied: 12, total: 20 });
    expect(verifyRuling({ reasoning: stored, onchainReasoningHash: r.reasoningHash, onchainProposedBps: 2110, sow: byId.A.sow })).toMatchObject({
      ok: true, hashMatches: true, bpsMatchesFormula: true, fulfilledMatches: true, sowMatches: true,
    });
    // audit trail says a fallback ruled, and which scenario
    expect(store.db.prepare("SELECT provider, model, request_json FROM agent_calls").get()).toEqual({ provider: "demo", model: "demo-fallback", request_json: '{"demoScenario":"A"}' });
  });

  it("matches seeded demo drafts (real wallets, fresh deadline) by their scoring fingerprint", async () => {
    const store = new SowStore(":memory:");
    const seeded = seedDemoDrafts(store, scenarios, {
      buyer: "0xAAAA000000000000000000000000000000000001", seller: "0xbbbb000000000000000000000000000000000002",
      token: "0x3333333333333333333333333333333333333333", reviewWindowSecs: 120, now: 1_800_000_000,
    });
    for (const s of seeded) {
      const sow = JSON.parse(store.getLatestVersion(s.draftId)!.sowJson) as Sow;
      expect(hashSow(sow)).toBe(s.sowHash);
      expect(hashSow(sow)).not.toBe(hashSow(byId[s.scenario].sow)); // parties/deadline differ from the fixture…
      expect(demoFingerprint(sow)).toBe(demoFingerprint(byId[s.scenario].sow)); // …but the scored content is identical
      const r = await scoreDispute(inputFor(sow), { ...noLlm, store: new SowStore(":memory:"), demoFallback: true });
      expect(r.buyerBps).toBe(s.expectedBps);
    }
    expect(findDemoScenario(byId.D.sow)?.id).toBe("A"); // D shares A's SOW and ground truth
  });

  it("a non-demo SOW → clear error", async () => {
    const other: Sow = { ...byId.A.sow, title: "Something else entirely" };
    const err = await scoreDispute(inputFor(other), { ...noLlm, demoFallback: true }).catch((e) => e);
    expect(err).toBeInstanceOf(DemoFallbackError);
    expect(err.message).toMatch(/doesn't match any demo scenario/);
  });
});

describe("AGENT_FALLBACK_ON_FAILURE", () => {
  const quota = () => new ApiError({ status: 429, message: '{"error":{"code":429,"details":[{"retryDelay":"120s"}]}}' });
  const gemini = (model: string, ...steps: (Error | object)[]) => {
    let n = 0;
    const models: GeminiModelsApi = {
      generateContent: async () => {
        const s = steps[Math.min(n++, steps.length - 1)];
        if (s instanceof Error) throw s;
        return s as Awaited<ReturnType<GeminiModelsApi["generateContent"]>>;
      },
    };
    return { client: new GeminiLlmClient(model, "k", models), calls: () => n };
  };
  const backoff = { cooldowns: new ModelCooldowns(), sleep: async () => {}, now: () => 0 };

  it("kicks in only after every live model fails (quota), marked 'demo-fallback (live failed)'", async () => {
    const a = gemini("m1", quota());
    const b = gemini("m2", quota());
    const store = new SowStore(":memory:");
    const r = await scoreDispute(inputFor(byId.A.sow), { llm: [a.client, b.client], store, demoFallback: false, fallbackOnFailure: true, backoff: { ...backoff, cooldowns: new ModelCooldowns() }, now: () => 1 });
    expect(a.calls()).toBe(1);
    expect(b.calls()).toBe(1);
    expect(r).toMatchObject({ buyerBps: 2110, model: "demo-fallback (live failed)", promptVersion: "v3" });
    const rows = store.db.prepare("SELECT model, status_code FROM agent_calls ORDER BY id").all();
    expect(rows).toEqual([{ model: "m1", status_code: 429 }, { model: "m2", status_code: 429 }, { model: "demo-fallback (live failed)", status_code: null }]);
  });

  it("does not trigger when a live model answers", async () => {
    const truth = { scores: byId.A.sow.deliverables.map((d) => ({ id: d.id, criteria: byId.A.groundTruth[d.id].map((v, index) => ({ index, ...v, rationale: "live", evidenceRefs: [] })) })) };
    const live = gemini("m1", { functionCalls: [{ name: "submit_scores", args: truth }], candidates: [{ finishReason: "STOP" }] });
    const r = await scoreDispute(inputFor(byId.A.sow), { llm: live.client, store: new SowStore(":memory:"), demoFallback: false, fallbackOnFailure: true, promptVersion: "v3", backoff, now: () => 1 });
    expect(r.model).toBe("m1");
  });

  it("does not trigger on invalid model output (that's a quality failure, not an outage)", async () => {
    const junk: LlmClient = { model: "m1", callTool: async () => ({ scores: [] }) };
    await expect(scoreDispute(inputFor(byId.A.sow), { llm: junk, store: new SowStore(":memory:"), demoFallback: false, fallbackOnFailure: true, promptVersion: "v3", now: () => 1 })).rejects.toBeInstanceOf(DisputeScoringError);
  });

  it("is off by default, and never rules a non-demo SOW (the original error is rethrown)", async () => {
    const off = await scoreDispute(inputFor(byId.A.sow), { llm: gemini("m1", quota()).client, store: new SowStore(":memory:"), demoFallback: false, fallbackOnFailure: false, backoff: { ...backoff, cooldowns: new ModelCooldowns() }, now: () => 1 }).catch((e) => e);
    expect(off).toBeInstanceOf(LlmUnavailableError);
    const other: Sow = { ...byId.A.sow, title: "Not a demo" };
    const nonDemo = await scoreDispute(inputFor(other), { llm: gemini("m1", quota()).client, store: new SowStore(":memory:"), demoFallback: false, fallbackOnFailure: true, backoff: { ...backoff, cooldowns: new ModelCooldowns() }, now: () => 1 }).catch((e) => e);
    expect(nonDemo).toBeInstanceOf(LlmUnavailableError);
    expect(nonDemo.message).toMatch(/rate-limited/);
  });

  it("with no key configured, the index entry point falls back via env", async () => {
    const saved = { ...process.env };
    try {
      delete process.env.LLM_API_KEY;
      process.env.AGENT_FALLBACK_ON_FAILURE = "true";
      const r = await scoreDisputeFromIndex(inputFor(byId.C.sow), { store: new SowStore(":memory:"), demoFallback: false, now: () => 1 });
      expect(r).toMatchObject({ buyerBps: 8000, model: "demo-fallback (live failed)" });
    } finally {
      process.env = saved;
    }
  });

  it("the default prompt version is v3", async () => {
    const saved = process.env.AGENT_PROMPT_VERSION;
    delete process.env.AGENT_PROMPT_VERSION;
    try {
      let system = "";
      const spy: LlmClient = { model: "m", callTool: async (req) => { system = req.system; return { scores: [] }; } };
      await scoreDispute(inputFor(byId.A.sow), { llm: spy, store: new SowStore(":memory:"), demoFallback: false, now: () => 1 }).catch(() => {});
      expect(system).toMatch(/You give verdicts only; code computes all percentages/);
    } finally {
      if (saved !== undefined) process.env.AGENT_PROMPT_VERSION = saved;
    }
  });
});
