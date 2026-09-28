// Picks the LlmClient implementation from env. The only place that knows about vendor SDKs.
import { AnthropicLlmClient } from "./anthropicClient";
import { GeminiLlmClient } from "./geminiClient";
import type { LlmClient } from "./llm";
import { OPENAI_COMPAT_PROVIDERS, OpenAICompatClient, type OpenAICompatProvider } from "./openaiCompatClient";

export type LlmProvider = "gemini" | "anthropic";

/**
 * LLM_PROVIDER = "gemini" (default) | "anthropic"; LLM_API_KEY = key for that provider; LLM_MODEL = model id.
 * Returns undefined when no key is set (agents then need AGENT_DEMO_FALLBACK=true).
 * Throws on an unknown provider, or gemini without LLM_MODEL.
 */
export function createLlmClient(env: NodeJS.ProcessEnv = process.env): LlmClient | undefined {
  const provider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  if (provider !== "gemini" && provider !== "anthropic") {
    throw new Error(`LLM_PROVIDER must be "gemini" or "anthropic", got "${env.LLM_PROVIDER}"`);
  }
  const key = env.LLM_API_KEY;
  if (!key) return undefined;
  if (provider === "anthropic") return new AnthropicLlmClient(env.LLM_MODEL || "claude-sonnet-5", key);
  if (!env.LLM_MODEL) {
    throw new Error("LLM_MODEL is not set. With LLM_PROVIDER=gemini, run `npm run models` (in backend/) and set LLM_MODEL to one of the listed names.");
  }
  return new GeminiLlmClient(env.LLM_MODEL, key);
}

export type ChainProvider = "gemini" | "anthropic" | OpenAICompatProvider;
const CHAIN_PROVIDERS: readonly ChainProvider[] = ["groq", "openrouter", "gemini", "anthropic"];

/** "groq:model-a, gemini:gemini-2.5-flash" → entries. Splits on the FIRST ":" (OpenRouter ids may contain ":"). */
export function parseLlmChain(spec: string): { provider: ChainProvider; model: string }[] {
  return spec
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const i = entry.indexOf(":");
      const provider = (i > 0 ? entry.slice(0, i).trim().toLowerCase() : "") as ChainProvider;
      const model = i > 0 ? entry.slice(i + 1).trim() : "";
      if (!CHAIN_PROVIDERS.includes(provider) || !model) {
        throw new Error(`LLM_CHAIN entry "${entry}" must be provider:model with provider one of ${CHAIN_PROVIDERS.join(", ")}`);
      }
      return { provider, model };
    });
}

/**
 * Key for a chain entry: GROQ_API_KEY / OPENROUTER_API_KEY; gemini → GEMINI_API_KEY, else LLM_API_KEY when
 * LLM_PROVIDER is gemini (or unset); anthropic → ANTHROPIC_API_KEY, else LLM_API_KEY when LLM_PROVIDER is anthropic.
 * (LLM_API_KEY is never sent to a provider it wasn't configured for.)
 */
export function chainKeyFor(provider: ChainProvider, env: NodeJS.ProcessEnv): { key?: string; envName: string } {
  if (provider === "groq" || provider === "openrouter") {
    const envName = OPENAI_COMPAT_PROVIDERS[provider].keyEnv;
    return { key: env[envName], envName };
  }
  const own = provider === "gemini" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY";
  const legacy = (env.LLM_PROVIDER || "gemini").toLowerCase() === provider ? env.LLM_API_KEY : undefined;
  return { key: env[own] || legacy, envName: `${own} (or LLM_API_KEY with LLM_PROVIDER=${provider})` };
}

const warned = new Set<string>();

/**
 * The model chain used by the router and the dispute agent.
 * - LLM_CHAIN set: ordered provider:model entries (each gets id "provider:model"); entries without a key are skipped
 *   with a one-time warning. undefined if no entry has a key.
 * - LLM_CHAIN unset (legacy): LLM_PROVIDER/LLM_MODEL primary + LLM_FALLBACK_MODELS (same provider and key).
 */
export function createLlmChain(env: NodeJS.ProcessEnv = process.env): LlmClient[] | undefined {
  if (env.LLM_CHAIN?.trim()) {
    const clients: LlmClient[] = [];
    const seen = new Set<string>();
    for (const { provider, model } of parseLlmChain(env.LLM_CHAIN)) {
      const id = `${provider}:${model}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const { key, envName } = chainKeyFor(provider, env);
      if (!key) {
        if (!warned.has(id)) {
          warned.add(id);
          console.warn(`[llm] LLM_CHAIN: skipping ${id} — ${envName} is not set`);
        }
        continue;
      }
      const client =
        provider === "gemini" ? new GeminiLlmClient(model, key)
        : provider === "anthropic" ? new AnthropicLlmClient(model, key)
        : new OpenAICompatClient(provider, model, key);
      client.id = id;
      clients.push(client);
    }
    return clients.length ? clients : undefined;
  }

  const primary = createLlmClient(env);
  if (!primary) return undefined;
  const fallbacks = (env.LLM_FALLBACK_MODELS ?? "")
    .split(",")
    .map((m) => m.trim())
    .filter((m, i, all) => m && m !== primary.model && all.indexOf(m) === i);
  return [primary, ...fallbacks.map((m) => createLlmClient({ ...env, LLM_MODEL: m })!)];
}
