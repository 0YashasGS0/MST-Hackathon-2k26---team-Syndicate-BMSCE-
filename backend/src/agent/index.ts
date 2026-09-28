// B1's entry point for the dispute agent. Composition root: fills the LLM client from env.
import { createLlmClient } from "./createLlmClient";
import { scoreDispute as scoreDisputeCore, type DisputeInput, type Ruling, type ScorerDeps } from "./scoreDispute";

export { DisputeScoringError, type DisputeInput, type Reasoning, type Ruling, type ScorerDeps } from "./scoreDispute";
export { LlmUnavailableError } from "./toolRetry";
export { createLlmClient } from "./createLlmClient";

let envClient: { llm: ReturnType<typeof createLlmClient> } | undefined;

/** Scores a dispute. deps.llm defaults to createLlmClient() (LLM_PROVIDER / LLM_API_KEY / LLM_MODEL). */
export function scoreDispute(input: DisputeInput, deps: ScorerDeps = {}): Promise<Ruling> {
  const demo = deps.demoFallback ?? process.env.AGENT_DEMO_FALLBACK === "true";
  if (!deps.llm && !demo) envClient ??= { llm: createLlmClient() };
  return scoreDisputeCore(input, { ...deps, llm: deps.llm ?? envClient?.llm });
}
