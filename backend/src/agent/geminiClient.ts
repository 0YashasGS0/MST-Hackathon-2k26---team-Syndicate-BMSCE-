// Google Gemini implementation of LlmClient (default provider), via the official @google/genai SDK.
// Structured output = function calling with mode ANY restricted to the one function we declare.
import { ApiError, FunctionCallingConfigMode, GoogleGenAI, type GenerateContentParameters, type GenerateContentResponse } from "@google/genai";
import { geminiToolSchema } from "./geminiSchema";
import { LlmOutputError, type LlmCallInfo, type LlmClient, type ToolCallRequest } from "./llm";

export { toGeminiSchema } from "./geminiSchema";

/** Gemini refused our function declaration (non-transient; never retried). */
export class GeminiSchemaError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(`Gemini rejected tool schema: ${message}`);
  }
}

/** The slice of the SDK we use; injectable so tests can mock it. */
export type GeminiModelsApi = {
  generateContent(params: GenerateContentParameters): Promise<Pick<GenerateContentResponse, "functionCalls" | "candidates" | "promptFeedback">>;
};

export class GeminiLlmClient implements LlmClient {
  readonly provider = "gemini";
  id?: string; // "gemini:<model>" when built from LLM_CHAIN
  /** Always forced: every Gemini model gets mode ANY restricted to the one declared function. */
  readonly toolMode = "ANY (allowedFunctionNames = [the one declared function])";
  private readonly models: GeminiModelsApi;
  lastCall?: LlmCallInfo;

  constructor(
    readonly model: string,
    apiKey: string,
    models?: GeminiModelsApi,
  ) {
    // SDK retries off (attempts: 1): transient retries/fallback happen in resilience.ts, where each try is logged.
    this.models = models ?? new GoogleGenAI({ apiKey, httpOptions: { retryOptions: { attempts: 1 } } }).models;
  }

  async callTool({ system, prompt, tool }: ToolCallRequest): Promise<unknown> {
    const started = Date.now();
    let res: Awaited<ReturnType<GeminiModelsApi["generateContent"]>>;
    try {
      res = await this.models.generateContent({
        model: this.model,
        contents: prompt,
        config: {
          systemInstruction: system,
          temperature: 0,
          maxOutputTokens: 8192,
          // Sanitized: no numeric/length bounds (Gemini rejects them as "too many states"); bounds live in descriptions.
          tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: geminiToolSchema(tool) }] }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [tool.name] } },
        },
      });
    } catch (err) {
      if (isSchemaRejection(err)) throw new GeminiSchemaError(err.message);
      throw err;
    }
    const call = (res.functionCalls ?? []).find((c) => c.name === tool.name);
    const finish = res.candidates?.[0]?.finishReason ?? null;
    this.lastCall = { forcedToolChoice: true, toolCalled: !!call, stopReason: finish, latencyMs: Date.now() - started };

    if (!call) {
      const why = res.promptFeedback?.blockReason ? `prompt blocked (${res.promptFeedback.blockReason})` : `finishReason=${finish ?? "none"}`;
      throw new LlmOutputError(`model did not call ${tool.name} (${why})`);
    }
    if (!call.args || typeof call.args !== "object") throw new LlmOutputError(`${tool.name} was called without arguments`);
    return call.args;
  }
}

function isSchemaRejection(err: unknown): err is ApiError {
  return err instanceof ApiError && err.status === 400 && /schema|too many states|function declaration|parameters/i.test(err.message);
}
