// B1's entry point for the dispute agent. Composition root: fills the LLM client from env.
import { createLlmChain } from "./createLlmClient";
import { scoreDispute as scoreDisputeCore, type DisputeInput, type Ruling, type ScorerDeps } from "./scoreDispute";

export { DemoFallbackError, DisputeScoringError, type DisputeInput, type Reasoning, type Ruling, type ScorerDeps } from "./scoreDispute";
export { LlmUnavailableError } from "./toolRetry";
export { createLlmChain, createLlmClient } from "./createLlmClient";

let envClient: { llm: ReturnType<typeof createLlmChain> } | undefined;

/** Scores a dispute. deps.llm defaults to createLlmChain() (LLM_PROVIDER / LLM_API_KEY / LLM_MODEL / LLM_FALLBACK_MODELS). */
export function scoreDispute(input: DisputeInput, deps: ScorerDeps = {}): Promise<Ruling> {
  const demo = deps.demoFallback ?? process.env.AGENT_DEMO_FALLBACK === "true";
  if (!deps.llm && !demo) envClient ??= { llm: createLlmChain() };
  return scoreDisputeCore(input, { ...deps, llm: deps.llm ?? envClient?.llm });
}
