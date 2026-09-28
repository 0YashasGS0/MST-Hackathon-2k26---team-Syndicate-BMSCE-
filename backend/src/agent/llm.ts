// Vendor-neutral LLM interface. Agent logic (mergeSow, scoreDispute) depends ONLY on this file.
// Implementations: anthropicClient.ts, geminiClient.ts. Selection: createLlmClient.ts.

/** JSON-Schema-style tool definition; each provider converts it to its own format. */
export type ToolDef = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties?: boolean };
};

export type ToolCallRequest = { system: string; prompt: string; tool: ToolDef };

/** Metadata about the most recent call (no prompt, no headers, no key) — used by the smoke scripts. */
export type LlmCallInfo = { forcedToolChoice: boolean; toolCalled: boolean; stopReason: string | null; latencyMs: number };

export interface LlmClient {
  readonly model: string;
  /** "gemini" | "anthropic" | test mocks; recorded in agent_calls. */
  readonly provider?: string;
  lastCall?: LlmCallInfo;
  /** Returns the raw (unvalidated) arguments of the single tool/function call. Throws LlmOutputError if none was made. */
  callTool(req: ToolCallRequest): Promise<unknown>;
}

/** The model answered but not in a usable shape (no tool call, refusal, truncation) — worth one retry. */
export class LlmOutputError extends Error {}
