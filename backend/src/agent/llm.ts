// Vendor-neutral LLM interface. Agent logic (mergeSow, scoreDispute) depends ONLY on this file.
// Implementations: anthropicClient.ts, geminiClient.ts. Selection: createLlmClient.ts.

/** JSON-Schema-style tool definition; each provider converts it to its own format. */
export type ToolDef = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties?: boolean };
  /**
   * Plain-words restatement of constraints, by field path ("scores", "deliverables[].weightBps"), for providers that
   * must strip validation keywords (Gemini). Never sent as part of the schema itself.
   */
  constraintNotes?: Record<string, string>;
};

export type ToolCallRequest = { system: string; prompt: string; tool: ToolDef };

/** Metadata about the most recent call (no prompt, no headers, no key) — used by the smoke scripts. */
export type LlmCallInfo = { forcedToolChoice: boolean; toolCalled: boolean; stopReason: string | null; latencyMs: number; toolMode?: string };

export interface LlmClient {
  readonly model: string;
  /** "provider:model" for LLM_CHAIN entries; recorded as the model in agent_calls and reasoning. Unset for legacy config. */
  readonly id?: string;
  /** "gemini" | "anthropic" | test mocks; recorded in agent_calls. */
  readonly provider?: string;
  /** The configured forcing mode, for diagnostics (e.g. "ANY [submit_sow]" on Gemini). */
  readonly toolMode?: string;
  lastCall?: LlmCallInfo;
  /** Returns the raw (unvalidated) arguments of the single tool/function call. Throws LlmOutputError if none was made. */
  callTool(req: ToolCallRequest): Promise<unknown>;
}

/** The model answered but not in a usable shape (no tool call, refusal, truncation) — worth one retry. */
export class LlmOutputError extends Error {}

/** What gets recorded as "the model": "provider:model" for chain entries, else the plain model name. */
export const labelOf = (c: LlmClient): string => c.id ?? c.model;
