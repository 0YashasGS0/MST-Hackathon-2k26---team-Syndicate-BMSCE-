// Google Gemini implementation of LlmClient (default provider), via the official @google/genai SDK.
// Structured output = function calling with mode ANY restricted to the one function we declare.
import { FunctionCallingConfigMode, GoogleGenAI, Type, type GenerateContentParameters, type GenerateContentResponse, type Schema } from "@google/genai";
import { LlmOutputError, type LlmCallInfo, type LlmClient, type ToolCallRequest, type ToolDef } from "./llm";

/** The slice of the SDK we use; injectable so tests can mock it. */
export type GeminiModelsApi = {
  generateContent(params: GenerateContentParameters): Promise<Pick<GenerateContentResponse, "functionCalls" | "candidates" | "promptFeedback">>;
};

export class GeminiLlmClient implements LlmClient {
  readonly provider = "gemini";
  private readonly models: GeminiModelsApi;
  lastCall?: LlmCallInfo;

  constructor(
    readonly model: string,
    apiKey: string,
    models?: GeminiModelsApi,
  ) {
    this.models = models ?? new GoogleGenAI({ apiKey }).models;
  }

  async callTool({ system, prompt, tool }: ToolCallRequest): Promise<unknown> {
    const started = Date.now();
    const res = await this.models.generateContent({
      model: this.model,
      contents: prompt,
      config: {
        systemInstruction: system,
        temperature: 0,
        maxOutputTokens: 8192,
        tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.input_schema) }] }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [tool.name] } },
      },
    });
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

const TYPES: Record<string, Type> = {
  object: Type.OBJECT,
  array: Type.ARRAY,
  string: Type.STRING,
  integer: Type.INTEGER,
  number: Type.NUMBER,
  boolean: Type.BOOLEAN,
};

/**
 * JSON Schema → Gemini Schema (an OpenAPI 3.0 subset, see `Schema` in @google/genai).
 * Kept: type, description, properties (+ propertyOrdering), required, items, enum, minimum/maximum,
 * minItems/maxItems, minLength/maxLength (the SDK types these as strings). Everything else
 * (e.g. additionalProperties) is dropped; zod validation + retry in toolRetry.ts still enforces the full rules.
 */
export function toGeminiSchema(js: ToolDef["input_schema"] | Record<string, unknown>): Schema {
  const s = js as Record<string, unknown>;
  const type = TYPES[String(s.type)];
  if (!type) throw new Error(`toGeminiSchema: unsupported type ${JSON.stringify(s.type)}`);
  const out: Schema = { type };
  if (typeof s.description === "string") out.description = s.description;
  if (Array.isArray(s.enum)) out.enum = s.enum.map(String);
  if (typeof s.minimum === "number") out.minimum = s.minimum;
  if (typeof s.maximum === "number") out.maximum = s.maximum;
  for (const k of ["minItems", "maxItems", "minLength", "maxLength"] as const) {
    if (typeof s[k] === "number") out[k] = String(s[k]);
  }
  if (s.properties && typeof s.properties === "object") {
    const props = s.properties as Record<string, Record<string, unknown>>;
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.propertyOrdering = Object.keys(props);
  }
  if (Array.isArray(s.required)) out.required = s.required.map(String);
  if (s.items && typeof s.items === "object") out.items = toGeminiSchema(s.items as Record<string, unknown>);
  return out;
}
