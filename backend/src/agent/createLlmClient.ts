// Picks the LlmClient implementation from env. The only place that knows about vendor SDKs.
import { AnthropicLlmClient } from "./anthropicClient";
import { GeminiLlmClient } from "./geminiClient";
import type { LlmClient } from "./llm";

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
