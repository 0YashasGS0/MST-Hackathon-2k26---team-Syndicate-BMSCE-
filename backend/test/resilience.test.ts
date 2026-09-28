import { describe, expect, it } from "vitest";
import { ApiError, FunctionCallingConfigMode, type GenerateContentParameters } from "@google/genai";
import { hashJson, hashSow, type Sow } from "@kernel-exploits/shared";
import { createLlmChain } from "../src/agent/createLlmClient";
import { GeminiLlmClient, type GeminiModelsApi } from "../src/agent/geminiClient";
import { MERGE_TOOL, mergeSow } from "../src/agent/mergeSow";
import { AllModelsFailedError, AllModelsRateLimitedError, ModelCooldowns, callWithFallback, isTransient } from "../src/agent/resilience";
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
    // a 429 is never retried on the same model (cooldown + move on); 503/network keep their 3 tries
    expect(err.message).toBe(
      "all LLM models failed: gemini-3.8-flash (503, 503, 503); gemini-3.7-flash (429); gemini-2.5-flash (network error, network error, network error)",
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

describe("429: per-model cooldown, no same-model retry", () => {
  const rate429 = (delay: string) =>
    new ApiError({ status: 429, message: `{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"${delay}"}]}}` });
  const req = { system: "s", prompt: "p", tool: MERGE_TOOL };
  function world() {
    let t = 1_000_000;
    const sleeps: number[] = [];
    return {
      sleeps,
      advance: (ms: number) => void (t += ms),
      opts: { cooldowns: new ModelCooldowns(), now: () => t, sleep: async (ms: number) => { sleeps.push(ms); t += ms; }, random: () => 0.5 },
    };
  }

  it("a 429 on the primary → fallback called immediately; primary not retried; 429 logged with its retryDelay", async () => {
    const w = world();
    const primary = scripted([api(429, '"retryDelay":"55s"')]);
    const second = scripted([fnCall("submit_sow", sowArgs)]);
    const store = new SowStore(":memory:");
    const r = await mergeSow(mergeInput, {
      llm: [new GeminiLlmClient("gemini-3.8-flash", "k", primary.models), new GeminiLlmClient("gemini-3.7-flash", "k", second.models)],
      token: TOKEN, demoFallback: false, backoff: w.opts,
      onCall: (a) => store.logAgentCall({ subject: "draft:x", kind: "merge-sow", promptVersion: "v1", ...a }, 1),
    });
    expect(primary.calls).toHaveLength(1);
    expect(second.calls).toHaveLength(1);
    expect(w.sleeps).toEqual([]);
    expect(r.model).toBe("gemini-3.7-flash");
    expect(store.db.prepare("SELECT model, status_code, transient, retry_delay_ms FROM agent_calls WHERE status_code = 429").all()).toEqual([
      { model: "gemini-3.8-flash", status_code: 429, transient: 1, retry_delay_ms: 55000 },
    ]);
  });

  it("the cooldown skips the primary on later calls until it expires", async () => {
    const w = world();
    const primary = scripted([api(429, '"retryDelay":"55s"'), fnCall("submit_sow", sowArgs)]);
    const second = scripted([fnCall("submit_sow", sowArgs)]);
    const chain = [new GeminiLlmClient("p", "k", primary.models), new GeminiLlmClient("f", "k", second.models)];
    expect((await callWithFallback(chain, req, undefined, w.opts)).client.model).toBe("f");
    w.advance(30_000);
    expect((await callWithFallback(chain, req, undefined, w.opts)).client.model).toBe("f"); // still cooling: no request to p
    expect(primary.calls).toHaveLength(1);
    w.advance(26_000); // past 55 s
    expect((await callWithFallback(chain, req, undefined, w.opts)).client.model).toBe("p");
    expect(primary.calls).toHaveLength(2);
  });

  it("all models cooling, earliest in 40 s → waits once, then succeeds on that model", async () => {
    const w = world();
    const a = scripted([api(429, '"retryDelay":"40s"'), fnCall("submit_sow", sowArgs)]);
    const b = scripted([api(429, '"retryDelay":"50s"')]);
    const waited: string[] = [];
    const chain = [new GeminiLlmClient("a", "k", a.models), new GeminiLlmClient("b", "k", b.models)];
    const r = await callWithFallback(chain, req, undefined, { ...w.opts, onCooldownWait: (m, ms) => waited.push(`${m} ${ms}`) });
    expect(r.client.model).toBe("a");
    expect(w.sleeps).toEqual([40_000]);
    expect(waited).toEqual(["a 40000"]);
    expect(a.calls).toHaveLength(2);
    expect(b.calls).toHaveLength(1);
  });

  it("all models cooling, earliest in 120 s → fails fast with a clear message, no request, no wait", async () => {
    const w = world();
    const a = scripted([api(429, '"retryDelay":"120s"')]);
    const b = scripted([api(429, '"retryDelay":"150s"')]);
    const chain = [new GeminiLlmClient("a", "k", a.models), new GeminiLlmClient("b", "k", b.models)];
    const err = await callWithFallback(chain, req, undefined, w.opts).catch((e) => e);
    expect(err).toBeInstanceOf(AllModelsRateLimitedError);
    expect(err.message).toBe("all models rate-limited; earliest retry in 120s (a +120s, b +150s)");
    expect(w.sleeps).toEqual([]);
    // a later call while still cooling makes no requests at all
    const again = await callWithFallback(chain, req, undefined, w.opts).catch((e) => e);
    expect(again.message).toMatch(/^all models rate-limited; earliest retry in 120s/);
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(1);
  });

  it("LLM_MAX_COOLDOWN_WAIT_MS sets the wait limit; a 429 without RetryInfo cools for 60 s", async () => {
    const w = world();
    const a = scripted([api(429, "429 RESOURCE_EXHAUSTED")]);
    const err = await callWithFallback([new GeminiLlmClient("a", "k", a.models)], req, undefined, { ...w.opts, maxCooldownWaitMs: 30_000 }).catch((e) => e);
    expect(err.message).toBe("all models rate-limited; earliest retry in 60s (a +60s)");
  });

  it("503 behaviour unchanged: 3 tries with backoff, no cooldown, retried again on the next call", async () => {
    const w = world();
    const p = scripted([api(503), api(503), api(503), fnCall("submit_sow", sowArgs)]);
    const f = scripted([fnCall("submit_sow", sowArgs)]);
    const chain = [new GeminiLlmClient("p", "k", p.models), new GeminiLlmClient("f", "k", f.models)];
    expect((await callWithFallback(chain, req, undefined, w.opts)).client.model).toBe("f");
    expect(p.calls).toHaveLength(3);
    expect(w.sleeps).toEqual([1000, 2000]);
    expect((await callWithFallback(chain, req, undefined, w.opts)).client.model).toBe("p"); // no cooldown for 503
  });
});

