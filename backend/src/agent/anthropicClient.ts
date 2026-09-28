// Anthropic implementation of LlmClient (optional provider: LLM_PROVIDER=anthropic).
import Anthropic from "@anthropic-ai/sdk";
import { LlmOutputError, type LlmCallInfo, type LlmClient, type ToolCallRequest } from "./llm";

// Models that still accept sampling params. Newer ones (Sonnet 5, Opus 4.7+, Fable) return 400 on temperature.
const SAMPLING_OK = /^claude-(haiku-4-5|sonnet-4-[56]|opus-4-[56]|3)/;
// Models that reject forced tool_choice ("tool"/"any") with a 400; use auto + an explicit instruction there.
const NO_FORCED_TOOL = /^claude-(opus-5-5|fable-5-1|mythos-5-1)/;

export class AnthropicLlmClient implements LlmClient {
  readonly provider = "anthropic";
  readonly toolMode: string;
  private readonly client: Anthropic;
  lastCall?: LlmCallInfo;

  constructor(
    readonly model: string,
    apiKey: string,
  ) {
    // logLevel "warn": never let SDK debug logging print request headers (API key) or prompts.
    // maxRetries 0: transient retries/fallback happen in resilience.ts, where each try is logged.
    this.client = new Anthropic({ apiKey, logLevel: "warn", maxRetries: 0 });
    this.toolMode = NO_FORCED_TOOL.test(model) ? "auto (model rejects forced tool_choice)" : "tool (forced)";
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
