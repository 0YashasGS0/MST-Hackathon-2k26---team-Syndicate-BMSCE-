// LLM access for the agent. Everything goes through LlmClient so tests can mock it.
import Anthropic from "@anthropic-ai/sdk";

export type ToolDef = {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required: string[]; additionalProperties?: boolean };
};

export type ToolCallRequest = { system: string; prompt: string; tool: ToolDef };

export interface LlmClient {
  readonly model: string;
  /** Returns the raw (unvalidated) input of the single tool call. Throws LlmOutputError if none was made. */
  callTool(req: ToolCallRequest): Promise<unknown>;
}

/** Metadata about the most recent call (no prompt, no headers, no key) — used by the smoke script. */
export type LlmCallInfo = { forcedToolChoice: boolean; toolCalled: boolean; stopReason: string | null; latencyMs: number };

/** The model answered but not in a usable shape (no tool call, refusal, truncation) — worth one retry. */
export class LlmOutputError extends Error {}

// Models that still accept sampling params. Newer ones (Sonnet 5, Opus 4.7+, Fable) return 400 on temperature.
const SAMPLING_OK = /^claude-(haiku-4-5|sonnet-4-[56]|opus-4-[56]|3)/;
// Models that reject forced tool_choice ("tool"/"any") with a 400; use auto + an explicit instruction there.
const NO_FORCED_TOOL = /^claude-(opus-5-5|fable-5-1|mythos-5-1)/;

export class AnthropicLlmClient implements LlmClient {
  private readonly client: Anthropic;
  lastCall?: LlmCallInfo;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    // logLevel "warn": never let SDK debug logging print request headers (API key) or prompts.
    this.client = new Anthropic({ apiKey, logLevel: "warn" });
  }

  async callTool({ system, prompt, tool }: ToolCallRequest): Promise<unknown> {
    const forced = !NO_FORCED_TOOL.test(this.model);
    const started = Date.now();
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 8000,
      system,
      tools: [tool],
      tool_choice: forced ? { type: "tool", name: tool.name } : { type: "auto" },
      ...(SAMPLING_OK.test(this.model) && { temperature: 0 }),
      messages: [
        { role: "user", content: forced ? prompt : `${prompt}\n\nRespond only by calling the ${tool.name} tool.` },
      ],
    });
    const call = res.content.find((b) => b.type === "tool_use" && b.name === tool.name);
    this.lastCall = { forcedToolChoice: forced, toolCalled: !!call, stopReason: res.stop_reason, latencyMs: Date.now() - started };
    if (res.stop_reason === "refusal") throw new LlmOutputError("model refused the request");
    if (res.stop_reason === "max_tokens") throw new LlmOutputError("model output was truncated (max_tokens)");
    if (!call || call.type !== "tool_use") throw new LlmOutputError(`model did not call ${tool.name}`);
    return call.input;
  }
}

/** Builds the real client from env (LLM_MODEL, LLM_API_KEY), or undefined if no key is configured. */
export function llmFromEnv(env: NodeJS.ProcessEnv = process.env): LlmClient | undefined {
  const key = env.LLM_API_KEY;
  if (!key) return undefined;
  return new AnthropicLlmClient(env.LLM_MODEL || "claude-sonnet-5", key);
}
