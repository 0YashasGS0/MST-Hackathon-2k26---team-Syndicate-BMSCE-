import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiLlmClient } from "../src/agent/geminiClient";
import { OpenAICompatClient } from "../src/agent/openaiCompatClient";
import { missingKeysFor, promptVersionBanner, resolveScriptChain } from "../src/agent/scriptEnv";
import { DEFAULT_PROMPT_VERSION } from "../src/agent/scoreDispute";

beforeEach(() => void vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("prompt version banner", () => {
  it("default when AGENT_PROMPT_VERSION is unset", () => {
    expect(DEFAULT_PROMPT_VERSION).toBe("v4");
    expect(promptVersionBanner({})).toEqual({ version: "v4", line: "prompt: v4 (default)" });
  });

  it("an .env value that differs from the code default is shown and warned about (not blocked)", () => {
    const b = promptVersionBanner({ AGENT_PROMPT_VERSION: "v3" });
    expect(b.version).toBe("v3");
    expect(b.line).toBe("prompt: v3 (from .env AGENT_PROMPT_VERSION — differs from code default v4)");
    expect(b.warning).toBe("warning: AGENT_PROMPT_VERSION=v3 in .env overrides the code default v4; remove it to use v4");
  });

  it("an .env value equal to the default: no warning; an unknown one: warned", () => {
    expect(promptVersionBanner({ AGENT_PROMPT_VERSION: "v4" })).toEqual({ version: "v4", line: "prompt: v4 (from .env AGENT_PROMPT_VERSION, same as code default)" });
    expect(promptVersionBanner({ AGENT_PROMPT_VERSION: "v9" }).warning).toMatch(/v9 is not a known prompt \(available: v1, v2, v3, v4\)/);
  });
});

describe("script chain resolution (any configured key is enough)", () => {
  it("a chain with only GROQ_API_KEY runs (no LLM_API_KEY needed); keyless entries are skipped", () => {
    const r = resolveScriptChain({ LLM_CHAIN: "groq:openai/gpt-oss-120b,gemini:gemini-2.5-flash", GROQ_API_KEY: "g" });
    expect("chain" in r).toBe(true);
    if ("chain" in r) {
      expect(r.chain.map((c) => c.id)).toEqual(["groq:openai/gpt-oss-120b"]);
      expect(r.chain[0]).toBeInstanceOf(OpenAICompatClient);
    }
  });

  it("GEMINI_API_KEY or OPENROUTER_API_KEY alone is enough too", () => {
    const g = resolveScriptChain({ LLM_CHAIN: "groq:a,gemini:gemini-2.5-flash", GEMINI_API_KEY: "m" });
    expect("chain" in g && g.chain.map((c) => c.id)).toEqual(["gemini:gemini-2.5-flash"]);
    const o = resolveScriptChain({ LLM_CHAIN: "groq:a,openrouter:x/y:free", OPENROUTER_API_KEY: "o" });
    expect("chain" in o && o.chain.map((c) => c.id)).toEqual(["openrouter:x/y:free"]);
  });

  it("a chain where no entry has a key fails with each entry and its missing env var", () => {
    const r = resolveScriptChain({ LLM_CHAIN: "groq:openai/gpt-oss-120b,gemini:gemini-2.5-flash,openrouter:x/y:free" });
    expect(r).toEqual({
      error: [
        "LLM_CHAIN has no entry with a key. Set at least one of:",
        "  groq:openai/gpt-oss-120b → GROQ_API_KEY",
        "  gemini:gemini-2.5-flash → GEMINI_API_KEY (or LLM_API_KEY with LLM_PROVIDER=gemini)",
        "  openrouter:x/y:free → OPENROUTER_API_KEY",
      ].join("\n"),
    });
  });

  it("a malformed LLM_CHAIN fails clearly", () => {
    expect(resolveScriptChain({ LLM_CHAIN: "openai:gpt" })).toEqual({ error: expect.stringMatching(/must be provider:model/) });
  });

  it("legacy (no LLM_CHAIN): GEMINI_API_KEY works in place of LLM_API_KEY; missing model or key → clear error", () => {
    const r = resolveScriptChain({ GEMINI_API_KEY: "m", LLM_MODEL: "gemini-2.5-flash" });
    expect("chain" in r && r.chain[0]).toBeInstanceOf(GeminiLlmClient);
    expect(resolveScriptChain({ GEMINI_API_KEY: "m" })).toEqual({ error: expect.stringMatching(/LLM_MODEL is not set/) });
    expect(resolveScriptChain({})).toEqual({ error: expect.stringMatching(/No LLM key found.*LLM_CHAIN=provider:model/) });
    // a Groq key alone doesn't configure the legacy (gemini) path — the message points to LLM_CHAIN
    expect(resolveScriptChain({ GROQ_API_KEY: "g" })).toEqual({ error: expect.stringMatching(/GROQ_API_KEY/) });
  });

  it("EVAL_COMPARE skip message names the missing env var per entry", () => {
    expect(missingKeysFor("groq:a,gemini:b", {})).toBe("groq:a → GROQ_API_KEY; gemini:b → GEMINI_API_KEY (or LLM_API_KEY with LLM_PROVIDER=gemini)");
  });
});
