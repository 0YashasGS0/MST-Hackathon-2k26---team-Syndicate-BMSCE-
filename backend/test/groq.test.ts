import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { hashJson, hashSow, verifyRuling, type Reasoning } from "@kernel-exploits/shared";
import { AnthropicLlmClient } from "../src/agent/anthropicClient";
import { chainKeyFor, createLlmChain, parseLlmChain } from "../src/agent/createLlmClient";
import { GeminiLlmClient } from "../src/agent/geminiClient";
import { STRIPPED_KEYWORDS } from "../src/agent/geminiSchema";
import { LlmOutputError, type LlmClient } from "../src/agent/llm";
import { MERGE_TOOL, mergeSow } from "../src/agent/mergeSow";
import { OpenAICompatClient, type ChatCompletionsApi } from "../src/agent/openaiCompatClient";
import { ModelCooldowns, retryDelayOf } from "../src/agent/resilience";
import { loadScenarios } from "../src/agent/scenarios";
import { scoreDispute } from "../src/agent/scoreDispute";
import { SowStore } from "../src/sow/store";

type Step = Error | { toolName?: string; args?: unknown; text?: string; finish?: string };
/** Mocked `chat.completions`: plays back steps and records every request. */
function completions(...steps: Step[]) {
  const calls: ChatCompletionCreateParamsNonStreaming[] = [];
  const api: ChatCompletionsApi = {
    create: async (p) => {
      calls.push(p);
      const s = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (s instanceof Error) throw s;
      const tool_calls = s.toolName ? [{ id: "call_1", type: "function" as const, function: { name: s.toolName, arguments: JSON.stringify(s.args) } }] : undefined;
      return { choices: [{ index: 0, logprobs: null, finish_reason: (s.finish ?? (tool_calls ? "tool_calls" : "stop")) as "stop", message: { role: "assistant", content: s.text ?? null, refusal: null, tool_calls } }] };
    },
  };
  return { api, calls };
}
const httpErr = (status: number, message: string, headers?: Record<string, string>) =>
  Object.assign(new Error(message), { status, ...(headers && { headers: new Headers(headers) }) });

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
  buyer: "0x1111111111111111111111111111111111111111", seller: "0x2222222222222222222222222222222222222222",
  purpose: "Bakery site", buyerConstraints: "mobile", sellerPoints: "no hosting",
  amount: "100000000", deliveryDeadline: 1_800_000_000, reviewWindowSecs: 86400,
};
const TOKEN = "0x3333333333333333333333333333333333333333";
const allKeys = (v: unknown, acc = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, acc));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (acc.add(k), allKeys(x, acc));
  return acc;
};

describe("OpenAICompatClient (Groq / OpenRouter)", () => {
  it("forces the named tool, temperature 0, sanitized schema; parses the tool call", async () => {
    const { api, calls } = completions({ toolName: "submit_sow", args: sowArgs });
    const c = new OpenAICompatClient("groq", "llama-x", "k", api);
    expect(await c.callTool({ system: "sys", prompt: "p", tool: MERGE_TOOL })).toEqual(sowArgs);
    const req = calls[0];
    expect(req).toMatchObject({ model: "llama-x", temperature: 0, tool_choice: { type: "function", function: { name: "submit_sow" } } });
    expect(req.messages).toEqual([{ role: "system", content: "sys" }, { role: "user", content: "p" }]);
    expect(req.tools).toHaveLength(1);
    const params = (req.tools![0] as { function: { parameters: unknown } }).function.parameters;
    for (const k of STRIPPED_KEYWORDS) expect(allKeys(params).has(k), k).toBe(false);
    expect(JSON.stringify(params)).toContain("all weights must sum to exactly 10000");
    expect(c.lastCall).toMatchObject({ toolCalled: true, toolMode: "tool_choice=function (named)" });
  });

  it("a text-only reply is rejected (LlmOutputError) and triggers the validation retry", async () => {
    const { api, calls } = completions({ text: "Sure! Here is the SOW..." }, { toolName: "submit_sow", args: sowArgs });
    const c = new OpenAICompatClient("groq", "llama-x", "k", api);
    await expect(c.callTool({ system: "s", prompt: "p", tool: MERGE_TOOL })).rejects.toThrow(/text-only reply/);
    const r = await mergeSow(mergeInput, { llm: new OpenAICompatClient("groq", "llama-x", "k", completions({ text: "no" }, { toolName: "submit_sow", args: sowArgs }).api), token: TOKEN, demoFallback: false });
    expect(r.sow.deliverables).toHaveLength(2);
    expect(calls).toHaveLength(1);
  });

  it('named tool_choice unsupported → retries with tool_choice "required", still verifies the tool name, and stays in that mode', async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { api, calls } = completions(
      httpErr(400, "tool_choice with a specific function is not supported for this model"),
      { toolName: "submit_sow", args: sowArgs },
      { toolName: "something_else", args: {} },
    );
    const c = new OpenAICompatClient("groq", "llama-x", "k", api);
    expect(await c.callTool({ system: "s", prompt: "p", tool: MERGE_TOOL })).toEqual(sowArgs);
    expect(calls.map((x) => x.tool_choice)).toEqual([{ type: "function", function: { name: "submit_sow" } }, "required"]);
    expect(c.toolMode).toMatch(/"required"/);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/named tool_choice rejected; using tool_choice="required"/));
    // next call goes straight to "required"; a different tool name is rejected
    await expect(c.callTool({ system: "s", prompt: "p", tool: MERGE_TOOL })).rejects.toThrow(/called something_else instead of submit_sow/);
    expect(calls[2].tool_choice).toBe("required");
    warn.mockRestore();
  });

  it("Groq 400 tool_use_failed is treated as bad output (retryable), other 400s are not", async () => {
    const bad = new OpenAICompatClient("groq", "m", "k", completions(httpErr(400, "tool_use_failed: Failed to call a function. Please adjust your prompt.")).api);
    await expect(bad.callTool({ system: "s", prompt: "p", tool: MERGE_TOOL })).rejects.toBeInstanceOf(LlmOutputError);
    const other = new OpenAICompatClient("groq", "m", "k", completions(httpErr(400, "model_not_found")).api);
    await expect(other.callTool({ system: "s", prompt: "p", tool: MERGE_TOOL })).rejects.toMatchObject({ status: 400 });
  });

  it("reads Groq retry delays from retry-after and from 'try again in …'", () => {
    expect(retryDelayOf(httpErr(429, "Rate limit reached. Please try again in 7.66s.", { "retry-after": "8" }))).toBe(8000);
    expect(retryDelayOf(httpErr(429, "Rate limit reached. Please try again in 7.66s."))).toBe(7660);
    expect(retryDelayOf(httpErr(429, "Please try again in 1m2.5s"))).toBe(62500);
    expect(retryDelayOf(httpErr(429, "Please try again in 450ms"))).toBe(450);
  });
});

describe("LLM_CHAIN", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses provider:model in order; splits on the first ':' (OpenRouter ids); rejects unknown providers", () => {
    expect(parseLlmChain("groq:llama-3.3-70b-versatile, openrouter:meta-llama/llama-3.3-70b-instruct:free,gemini:gemini-2.5-flash")).toEqual([
      { provider: "groq", model: "llama-3.3-70b-versatile" },
      { provider: "openrouter", model: "meta-llama/llama-3.3-70b-instruct:free" },
      { provider: "gemini", model: "gemini-2.5-flash" },
    ]);
    expect(() => parseLlmChain("openai:gpt")).toThrow(/must be provider:model/);
    expect(() => parseLlmChain("groq")).toThrow(/must be provider:model/);
  });

  it("builds the chain in order with provider:model ids; replaces LLM_PROVIDER/LLM_MODEL/LLM_FALLBACK_MODELS", () => {
    const chain = createLlmChain({
      LLM_CHAIN: "groq:llama-a,gemini:gemini-2.5-flash,anthropic:claude-sonnet-5,openrouter:x/y:free",
      GROQ_API_KEY: "g", GEMINI_API_KEY: "m", ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o",
      LLM_PROVIDER: "gemini", LLM_MODEL: "ignored", LLM_FALLBACK_MODELS: "ignored-too",
    })!;
    expect(chain.map((c) => c.id)).toEqual(["groq:llama-a", "gemini:gemini-2.5-flash", "anthropic:claude-sonnet-5", "openrouter:x/y:free"]);
    expect(chain[0]).toBeInstanceOf(OpenAICompatClient);
    expect(chain[1]).toBeInstanceOf(GeminiLlmClient);
    expect(chain[2]).toBeInstanceOf(AnthropicLlmClient);
  });

  it("skips an entry without a key, warning once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { LLM_CHAIN: "groq:only-groq-no-key,gemini:gemini-2.5-flash", GEMINI_API_KEY: "m" };
    expect(createLlmChain(env)!.map((c) => c.id)).toEqual(["gemini:gemini-2.5-flash"]);
    createLlmChain(env);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("groq:only-groq-no-key"))).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith("[llm] LLM_CHAIN: skipping groq:only-groq-no-key — GROQ_API_KEY is not set");
    expect(createLlmChain({ LLM_CHAIN: "groq:nokey-2" })).toBeUndefined(); // no usable entry → no chain (fallback path)
  });

  it("LLM_API_KEY is used only for the provider LLM_PROVIDER names", () => {
    expect(chainKeyFor("gemini", { LLM_API_KEY: "k" }).key).toBe("k"); // LLM_PROVIDER defaults to gemini
    expect(chainKeyFor("anthropic", { LLM_API_KEY: "k" }).key).toBeUndefined();
    expect(chainKeyFor("anthropic", { LLM_API_KEY: "k", LLM_PROVIDER: "anthropic" }).key).toBe("k");
    expect(chainKeyFor("gemini", { LLM_API_KEY: "k", LLM_PROVIDER: "anthropic" }).key).toBeUndefined();
    expect(chainKeyFor("gemini", { GEMINI_API_KEY: "g", LLM_API_KEY: "k" }).key).toBe("g");
  });

  it("backward compatible without LLM_CHAIN: legacy clients, plain model names, no id", () => {
    const chain = createLlmChain({ LLM_API_KEY: "k", LLM_MODEL: "gemini-3.8-flash", LLM_FALLBACK_MODELS: "gemini-2.5-flash" })!;
    expect(chain.map((c) => [c.constructor.name, c.model, c.id])).toEqual([["GeminiLlmClient", "gemini-3.8-flash", undefined], ["GeminiLlmClient", "gemini-2.5-flash", undefined]]);
  });
});

describe("chain failover end to end (mocked)", () => {
  const A = loadScenarios().find((s) => s.id === "A")!;
  const truth = { scores: A.sow.deliverables.map((d) => ({ id: d.id, criteria: A.groundTruth[d.id].map((v, index) => ({ index, ...v, rationale: "r", evidenceRefs: ["E1"] })) })) };
  const input = { dealId: 3, sow: A.sow, sowHash: hashSow(A.sow), deliveryHash: "0x" + "aa".repeat(32), evidenceHash: "0x" + "bb".repeat(32), complaint: A.complaint, deliveryNotes: A.deliveryNotes, evidenceNotes: A.evidenceNotes };
  const withId = <T extends LlmClient & { id?: string }>(c: T, id: string) => ((c.id = id), c);

  it("groq 429 → cooldown → next entry answers; agent_calls, result and reasoningHash record provider:model", async () => {
    const groq = completions(httpErr(429, "Rate limit reached for model. Please try again in 30s."));
    const second = completions({ toolName: "submit_scores", args: truth });
    const chain = [
      withId(new OpenAICompatClient("groq", "llama-a", "k", groq.api), "groq:llama-a"),
      withId(new OpenAICompatClient("openrouter", "x/y:free", "k", second.api), "openrouter:x/y:free"),
    ];
    const store = new SowStore(":memory:");
    const cooldowns = new ModelCooldowns();
    const r = await scoreDispute(input, { llm: chain, store, demoFallback: false, promptVersion: "v3", now: () => 1, backoff: { cooldowns, sleep: async () => {} } });
    expect(groq.calls).toHaveLength(1); // not retried on 429
    expect(r).toMatchObject({ buyerBps: 2110, model: "openrouter:x/y:free" });
    const rows = store.db.prepare("SELECT provider, model, status_code, transient, retry_delay_ms, tool_mode FROM agent_calls ORDER BY id").all();
    expect(rows).toEqual([
      { provider: "groq", model: "groq:llama-a", status_code: 429, transient: 1, retry_delay_ms: 30000, tool_mode: "tool_choice=function (named)" },
      { provider: "openrouter", model: "openrouter:x/y:free", status_code: null, transient: 0, retry_delay_ms: null, tool_mode: "tool_choice=function (named)" },
    ]);
    const stored = store.getRuling(r.reasoningHash) as Reasoning;
    expect(stored.model).toBe("openrouter:x/y:free");
    expect(hashJson(stored)).toBe(r.reasoningHash);
    expect(hashJson({ ...stored, model: "x/y:free" })).not.toBe(r.reasoningHash); // the provider prefix is committed
    expect(verifyRuling({ reasoning: stored, onchainReasoningHash: r.reasoningHash, sow: A.sow })).toMatchObject({ ok: true });

    // the cooled groq entry is skipped on the next call
    await scoreDispute(input, { llm: chain, store, demoFallback: false, promptVersion: "v3", now: () => 1, backoff: { cooldowns, sleep: async () => {} } });
    expect(groq.calls).toHaveLength(1);
  });

  it("AGENT_FALLBACK_ON_FAILURE triggers only after the whole chain fails", async () => {
    const a = completions(httpErr(429, "try again in 90s"));
    const b = completions(httpErr(503, "busy"));
    const chain = [withId(new OpenAICompatClient("groq", "a", "k", a.api), "groq:a"), withId(new OpenAICompatClient("openrouter", "b", "k", b.api), "openrouter:b")];
    const r = await scoreDispute(input, { llm: chain, store: new SowStore(":memory:"), demoFallback: false, fallbackOnFailure: true, promptVersion: "v3", now: () => 1, backoff: { cooldowns: new ModelCooldowns(), sleep: async () => {} } });
    expect(a.calls).toHaveLength(1);
    expect(b.calls).toHaveLength(3); // 503 keeps its 3 tries
    expect(r.model).toBe("demo-fallback (live failed)");
  });
});
