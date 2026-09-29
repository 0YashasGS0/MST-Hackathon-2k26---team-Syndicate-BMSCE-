// OpenAI-compatible LlmClient (official "openai" SDK with a custom baseURL): Groq, OpenRouter.
// Forced tool call: tools = [one function], tool_choice = that function (falls back to "required" if the model rejects
// a named tool_choice — still exactly one tool declared, and the name is still verified). temperature 0.
// Parameters use the sanitized, bounds-free schema (like Gemini); zod + retry-once remain the real enforcement.
import OpenAI from "openai";
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import { sanitizeForGemini } from "./geminiSchema";
import { LlmOutputError, type LlmCallInfo, type LlmClient, type ToolCallRequest, type ToolDef } from "./llm";

export const OPENAI_COMPAT_PROVIDERS = {
  groq: { baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  openrouter: { baseURL: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY" },
} as const;
export type OpenAICompatProvider = keyof typeof OPENAI_COMPAT_PROVIDERS;

/** The slice of the SDK we use; injectable so tests can mock it. */
export type ChatCompletionsApi = { create(params: ChatCompletionCreateParamsNonStreaming): Promise<Pick<ChatCompletion, "choices">> };

type ToolMode = "named" | "required";

/** JSON Schema for OpenAI-style function parameters, without validation keywords (restated in descriptions). */
export function openaiToolParameters(tool: ToolDef): Record<string, unknown> {
  return sanitizeForGemini(tool.input_schema as Record<string, unknown>, tool.constraintNotes);
}

const statusOf = (err: unknown) => (err as { status?: unknown } | null)?.status;
const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

export class OpenAICompatClient implements LlmClient {
  readonly provider: OpenAICompatProvider;
  id?: string;
  lastCall?: LlmCallInfo;
  private readonly completions: ChatCompletionsApi;
  /** Starts as a named tool_choice; switches to "required" for this model after it rejects the named form once. */
  private mode: ToolMode = "named";

  constructor(
    provider: OpenAICompatProvider,
    readonly model: string,
    apiKey: string,
    completions?: ChatCompletionsApi,
  ) {
    this.provider = provider;
    // maxRetries 0: transient retries / cooldowns / fallback happen in resilience.ts, where every try is logged.
    this.completions = completions ?? new OpenAI({ apiKey, baseURL: OPENAI_COMPAT_PROVIDERS[provider].baseURL, maxRetries: 0 }).chat.completions;
  }

  get toolMode(): string {
    return this.mode === "named" ? "tool_choice=function (named)" : 'tool_choice="required" (named tool_choice unsupported by this model)';
  }

  async callTool({ system, prompt, tool }: ToolCallRequest): Promise<unknown> {
    const started = Date.now();
    const params = (mode: ToolMode): ChatCompletionCreateParamsNonStreaming => ({
      model: this.model,
      temperature: 0,
      max_tokens: 8192,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      tools: [{ type: "function", function: { name: tool.name, description: tool.description, parameters: openaiToolParameters(tool) } }],
      tool_choice: mode === "named" ? { type: "function", function: { name: tool.name } } : "required",
    });

    let res: Pick<ChatCompletion, "choices">;
    try {
      res = await this.completions.create(params(this.mode));
    } catch (err) {
      if (this.mode === "named" && rejectsNamedToolChoice(err)) {
        this.mode = "required";
        console.warn(`[llm] ${this.id ?? this.model}: named tool_choice rejected; using tool_choice="required" (one tool declared, name verified)`);
        try {
          res = await this.completions.create(params("required"));
        } catch (err2) {
          throw asOutputError(err2);
        }
      } else {
        throw asOutputError(err);
      }
    }

    const choice = res.choices[0];
    const call = choice?.message?.tool_calls?.find((c) => c.type === "function" && c.function.name === tool.name);
    this.lastCall = { forcedToolChoice: true, toolCalled: !!call, stopReason: choice?.finish_reason ?? null, latencyMs: Date.now() - started, toolMode: this.toolMode };
    if (choice?.finish_reason === "length") throw new LlmOutputError("model output was truncated (finish_reason=length)");
    if (!call || call.type !== "function") {
      const other = choice?.message?.tool_calls?.map((c) => (c.type === "function" ? c.function.name : c.type)).join(", ");
      throw new LlmOutputError(other ? `model called ${other} instead of ${tool.name}` : `model did not call ${tool.name} (text-only reply)`);
    }
    try {
      return JSON.parse(call.function.arguments);
    } catch {
      throw new LlmOutputError(`${tool.name} arguments are not valid JSON`);
    }
  }
}

/** 400 saying the model doesn't support a named/specific tool_choice. */
function rejectsNamedToolChoice(err: unknown): boolean {
  return statusOf(err) === 400 && /tool_choice|tool choice/i.test(messageOf(err)) && !/tool_use_failed/i.test(messageOf(err));
}

/** Groq answers 400 "tool_use_failed" when the model produced a malformed tool call: bad output, worth the retry. */
function asOutputError(err: unknown): unknown {
  if (statusOf(err) === 400 && /tool_use_failed|failed to call a function/i.test(messageOf(err))) {
    return new LlmOutputError(`model produced a malformed tool call: ${messageOf(err).slice(0, 200)}`);
  }
  return err;
}
