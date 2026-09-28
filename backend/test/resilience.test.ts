import { describe, expect, it } from "vitest";
import { ApiError, FunctionCallingConfigMode, type GenerateContentParameters } from "@google/genai";
import { hashJson, hashSow, type Sow } from "@kernel-exploits/shared";
import { createLlmChain } from "../src/agent/createLlmClient";
import { GeminiLlmClient, type GeminiModelsApi } from "../src/agent/geminiClient";
import { MERGE_TOOL, mergeSow } from "../src/agent/mergeSow";
import { AllModelsFailedError, callWithFallback, isTransient } from "../src/agent/resilience";
import { LlmUnavailableError, scoreDispute } from "../src/agent";
import { SowStore } from "../src/sow/store";

type Resp = Awaited<ReturnType<GeminiModelsApi["generateContent"]>>;
type Step = Resp | Error;

const fnCall = (name: string, args: Record<string, unknown>): Resp => ({ functionCalls: [{ name, args }], candidates: [{ finishReason: "STOP" as never }], promptFeedback: undefined });
const api = (status: number, message = `${status} error`) => new ApiError({ status, message });

/** Mocked SDK: plays back a script of responses/errors and records requests. */
function scripted(steps: Step[]) {
  const calls: GenerateContentParameters[] = [];
  const models: GeminiModelsApi = {
    generateContent: async (p) => {
      calls.push(p);
      const s = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    },
  };
  return { models, calls };
}

const sleeps: number[] = [];
const backoff = { sleep: async (ms: number) => void sleeps.push(ms), random: () => 0.5 };

const sowArgs = {
  title: "Bakery landing page",
  deliverables: [
    { id: "D1", title: "Homepage", description: "Homepage", acceptanceCriteria: ["mobile"], weightBps: 6000 },
    { id: "D2", title: "Menu", description: "Menu", acceptanceCriteria: ["20 items"], weightBps: 4000 },
  ],
  exclusions: [],
  conflicts: [],
};
const mergeInput = {
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  purpose: "Bakery site",
  buyerConstraints: "mobile",
  sellerPoints: "no hosting",
  amount: "100000000",
  deliveryDeadline: 1_800_000_000,
  reviewWindowSecs: 86400,
};
const TOKEN = "0x3333333333333333333333333333333333333333";

describe("Gemini forced mode", () => {
  it("every Gemini model, including ones the Anthropic client treats specially, is sent mode ANY + allowedFunctionNames", async () => {
    for (const model of ["gemini-3.8-flash", "gemini-2.5-pro", "claude-opus-5-5", "claude-fable-5-1", "anything"]) {
      const { models, calls } = scripted([fnCall("submit_sow", sowArgs)]);
      const c = new GeminiLlmClient(model, "k", models);
      await c.callTool({ system: "s", prompt: "p", tool: MERGE_TOOL });
      expect(calls[0].config?.toolConfig?.functionCallingConfig).toEqual({ mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["submit_sow"] });
      expect(c.toolMode).toMatch(/^ANY/);
    }
  });
});

describe("transient backoff + model fallback", () => {
  it("classifies 429/500/503/network as transient and 400 as not", () => {
    expect([429, 500, 503].map((s) => isTransient(api(s)))).toEqual([true, true, true]);
    expect(isTransient(api(400))).toBe(false);
    expect(isTransient(new TypeError("fetch failed"))).toBe(true);
    expect(isTransient(Object.assign(new Error("socket"), { code: "ECONNRESET" }))).toBe(true);
  });

  it("503 then success → succeeds; one transient retry logged with its status; validation retry not consumed", async () => {
    sleeps.length = 0;
    const { models, calls } = scripted([api(503, "503 UNAVAILABLE (high demand)"), fnCall("submit_sow", sowArgs)]);
    const store = new SowStore(":memory:");
    const r = await mergeSow(mergeInput, {
      llm: [new GeminiLlmClient("gemini-3.8-flash", "k", models)],
      token: TOKEN,
      demoFallback: false,
      backoff,
      onCall: (a) => store.logAgentCall({ subject: "draft:x", kind: "merge-sow", promptVersion: "v1", ...a }, 1),
    });
    expect(calls).toHaveLength(2);
    expect(r.model).toBe("gemini-3.8-flash");
    expect(sleeps).toEqual([1000]);
    const rows = store.db.prepare("SELECT attempt, model, status_code, transient, error FROM agent_calls ORDER BY id").all();
    expect(rows).toEqual([
      { attempt: 1, model: "gemini-3.8-flash", status_code: 503, transient: 1, error: expect.stringMatching(/transient try 1: 503 UNAVAILABLE/) },
      { attempt: 1, model: "gemini-3.8-flash", status_code: null, transient: 0, error: null },
    ]);
  });

  it("503 ×3 on the primary → falls back to model 2 → success; result and reasoningHash use model 2", async () => {
    sleeps.length = 0;
    const primary = scripted([api(503)]);
    const second = scripted([fnCall("submit_scores", { scores: [{ id: "D1", fulfilledPct: 100, rationale: "ok", evidenceRefs: [] }, { id: "D2", fulfilledPct: 0, rationale: "missing", evidenceRefs: [] }] })]);
    const { buyer, seller, amount, deliveryDeadline, reviewWindowSecs } = mergeInput;
    const fullSow: Sow = { version: "sow/v1", title: "t", buyer, seller, token: TOKEN, amount, deliveryDeadline, reviewWindowSecs, deliverables: sowArgs.deliverables, exclusions: [] };
    const store = new SowStore(":memory:");
    const r = await scoreDispute(
      { dealId: 9, sow: fullSow, sowHash: hashSow(fullSow), deliveryHash: "0x" + "aa".repeat(32), evidenceHash: "0x" + "bb".repeat(32), complaint: "c", deliveryNotes: "d", evidenceNotes: "e" },
      { llm: [new GeminiLlmClient("gemini-3.8-flash", "k", primary.models), new GeminiLlmClient("gemini-3.7-flash", "k", second.models)], store, demoFallback: false, promptVersion: "v1", backoff, now: () => 1 },
    );
    expect(primary.calls).toHaveLength(3);
    expect(second.calls).toHaveLength(1);
    expect(sleeps).toEqual([1000, 2000]); // ~1 s → ~2 s between the 3 tries; no wait before switching models
    expect(r.model).toBe("gemini-3.7-flash");
    const stored = store.getRuling(r.reasoningHash) as { model: string };
    expect(stored.model).toBe("gemini-3.7-flash");
    expect(hashJson(stored)).toBe(r.reasoningHash);
    const log = store.db.prepare("SELECT model, status_code, transient FROM agent_calls ORDER BY id").all();
    expect(log).toEqual([
      { model: "gemini-3.8-flash", status_code: 503, transient: 1 },
      { model: "gemini-3.8-flash", status_code: 503, transient: 1 },
      { model: "gemini-3.8-flash", status_code: 503, transient: 1 },
      { model: "gemini-3.7-flash", status_code: null, transient: 0 },
    ]);
  });

  it("all models fail → one clear error listing each model and its statuses", async () => {
    const chain = [
      new GeminiLlmClient("gemini-3.8-flash", "k", scripted([api(503)]).models),
      new GeminiLlmClient("gemini-3.7-flash", "k", scripted([api(429)]).models),
      new GeminiLlmClient("gemini-2.5-flash", "k", scripted([new TypeError("fetch failed")]).models),
    ];
    const err = await mergeSow(mergeInput, { llm: chain, token: TOKEN, demoFallback: false, backoff }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.message).toBe(
      "all LLM models failed: gemini-3.8-flash (503, 503, 503); gemini-3.7-flash (429, 429, 429); gemini-2.5-flash (network error, network error, network error)",
    );
  });

  it("a 400 (non-transient) fails immediately: no retry, no fallback, no sleep", async () => {
    sleeps.length = 0;
    const primary = scripted([api(400, "400 INVALID_ARGUMENT")]);
    const second = scripted([fnCall("submit_sow", sowArgs)]);
    const err = await mergeSow(mergeInput, {
      llm: [new GeminiLlmClient("gemini-3.8-flash", "k", primary.models), new GeminiLlmClient("gemini-3.7-flash", "k", second.models)],
      token: TOKEN,
      demoFallback: false,
      backoff,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.message).toMatch(/400 INVALID_ARGUMENT/);
    expect(primary.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(0);
    expect(sleeps).toEqual([]);
  });

  it("caps total backoff sleep at 10 s across the chain", async () => {
    sleeps.length = 0;
    const chain = ["a", "b", "c", "d", "e"].map((m) => new GeminiLlmClient(m, "k", scripted([api(503)]).models));
    await expect(callWithFallback(chain, { system: "s", prompt: "p", tool: MERGE_TOOL }, undefined, backoff)).rejects.toBeInstanceOf(AllModelsFailedError);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(10_000);
  });
});

describe("createLlmChain", () => {
  it("primary + LLM_FALLBACK_MODELS in order, deduped", () => {
    const chain = createLlmChain({ LLM_API_KEY: "k", LLM_MODEL: "gemini-3.8-flash", LLM_FALLBACK_MODELS: "gemini-3.7-flash, gemini-flash-latest,gemini-3.8-flash,,gemini-2.5-flash" });
    expect(chain?.map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.7-flash", "gemini-flash-latest", "gemini-2.5-flash"]);
    expect(createLlmChain({ LLM_API_KEY: "k", LLM_MODEL: "g" })?.map((c) => c.model)).toEqual(["g"]);
  });
});
