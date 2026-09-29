// Pure helpers for the CLI scripts (smoke:merge, smoke:score, eval:disputes): which prompt version is in use,
// and which LLM chain can run with the keys present. Kept out of scripts/_env.ts (which loads .env) so tests can
// call them with a fake env.
import { chainKeyFor, createLlmChain, parseLlmChain } from "./createLlmClient";
import type { LlmClient } from "./llm";
import { DEFAULT_PROMPT_VERSION, DISPUTE_PROMPTS } from "./scoreDispute";

export type PromptBanner = { version: string; line: string; warning?: string };

/** "prompt: v4 (default)" / "prompt: v3 (from .env AGENT_PROMPT_VERSION — differs from code default v4)" (+ warning). */
export function promptVersionBanner(env: NodeJS.ProcessEnv): PromptBanner {
  const fromEnv = env.AGENT_PROMPT_VERSION?.trim();
  if (!fromEnv) return { version: DEFAULT_PROMPT_VERSION, line: `prompt: ${DEFAULT_PROMPT_VERSION} (default)` };
  if (!DISPUTE_PROMPTS[fromEnv]) {
    return {
      version: fromEnv,
      line: `prompt: ${fromEnv} (from .env AGENT_PROMPT_VERSION — unknown)`,
      warning: `warning: AGENT_PROMPT_VERSION=${fromEnv} is not a known prompt (available: ${Object.keys(DISPUTE_PROMPTS).join(", ")}); scoring will fail`,
    };
  }
  if (fromEnv === DEFAULT_PROMPT_VERSION) return { version: fromEnv, line: `prompt: ${fromEnv} (from .env AGENT_PROMPT_VERSION, same as code default)` };
  return {
    version: fromEnv,
    line: `prompt: ${fromEnv} (from .env AGENT_PROMPT_VERSION — differs from code default ${DEFAULT_PROMPT_VERSION})`,
    warning: `warning: AGENT_PROMPT_VERSION=${fromEnv} in .env overrides the code default ${DEFAULT_PROMPT_VERSION}; remove it to use ${DEFAULT_PROMPT_VERSION}`,
  };
}

/**
 * The chain the scripts should use, or a clear error. Runs as soon as ANY configured entry has its key
 * (GROQ_API_KEY, GEMINI_API_KEY / LLM_API_KEY, OPENROUTER_API_KEY, ANTHROPIC_API_KEY).
 */
export function resolveScriptChain(env: NodeJS.ProcessEnv): { chain: LlmClient[] } | { error: string } {
  if (env.LLM_CHAIN?.trim()) {
    let entries: ReturnType<typeof parseLlmChain>;
    try {
      entries = parseLlmChain(env.LLM_CHAIN);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
    const chain = createLlmChain(env);
    if (chain) return { chain };
    return {
      error: [
        "LLM_CHAIN has no entry with a key. Set at least one of:",
        ...entries.map(({ provider, model }) => `  ${provider}:${model} → ${chainKeyFor(provider, env).envName}`),
      ].join("\n"),
    };
  }
  try {
    const chain = createLlmChain(env);
    if (chain) return { chain };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return {
    error:
      "No LLM key found. Either set LLM_CHAIN=provider:model,… with a key per provider (GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY), " +
      "or LLM_API_KEY / GEMINI_API_KEY with LLM_MODEL for LLM_PROVIDER.",
  };
}

/** For EVAL_COMPARE entries that get skipped: which env var each entry of the spec needs. */
export function missingKeysFor(spec: string, env: NodeJS.ProcessEnv): string {
  try {
    return parseLlmChain(spec)
      .map(({ provider, model }) => `${provider}:${model} → ${chainKeyFor(provider, env).envName}`)
      .join("; ");
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
