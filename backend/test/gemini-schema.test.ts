import { describe, expect, it } from "vitest";
import { ApiError, type GenerateContentParameters } from "@google/genai";
import { hashSow, type Sow } from "@kernel-exploits/shared";
import { AnthropicLlmClient, type AnthropicMessagesApi } from "../src/agent/anthropicClient";
import { GeminiLlmClient, GeminiSchemaError, type GeminiModelsApi } from "../src/agent/geminiClient";
import { STRIPPED_KEYWORDS, geminiToolSchema } from "../src/agent/geminiSchema";
import { MERGE_TOOL } from "../src/agent/mergeSow";
import { DisputeScoringError, LlmUnavailableError, scoreDispute } from "../src/agent";
import { SCORE_TOOL, scoreToolFor } from "../src/agent/scoreDispute";
import { SowStore } from "../src/sow/store";

const sow: Sow = {
  version: "sow/v1",
  title: "Bakery landing page",
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
  token: "0x3333333333333333333333333333333333333333",
  amount: "100000000",
  deliveryDeadline: 1_800_000_000,
  reviewWindowSecs: 86400,
  deliverables: [
    { id: "D1", title: "Homepage", description: "Homepage", acceptanceCriteria: ["mobile ok"], weightBps: 5000 },
    { id: "D2", title: "Menu", description: "Menu", acceptanceCriteria: ["20 items"], weightBps: 3000 },
    { id: "D3", title: "Contact", description: "Form", acceptanceCriteria: ["email arrives"], weightBps: 2000 },
  ],
  exclusions: [],
};

/** Every key name anywhere in a nested object. */
function allKeys(v: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => allKeys(x, acc));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
    acc.add(k);
    allKeys(x, acc);
  }
  return acc;
}

type Resp = Awaited<ReturnType<GeminiModelsApi["generateContent"]>>;
const scoresCall = (scores: unknown[]): Resp => ({ functionCalls: [{ name: "submit_scores", args: { scores } }], candidates: [{ finishReason: "STOP" as never }], promptFeedback: undefined });
function gemini(...steps: (Resp | Error)[]) {
  const calls: GenerateContentParameters[] = [];
  const models: GeminiModelsApi = {
    generateContent: async (p) => {
      calls.push(p);
      const s = steps[Math.min(calls.length - 1, steps.length - 1)];
      if (s instanceof Error) throw s;
      return s;
    },
  };
  return { client: new GeminiLlmClient("gemini-2.5-flash", "k", models), calls };
}
const sc = (id: string, fulfilledPct: number) => ({ id, fulfilledPct, rationale: "r", evidenceRefs: [] });
const input = {
  dealId: 1, sow, sowHash: hashSow(sow), deliveryHash: "0x" + "aa".repeat(32), evidenceHash: "0x" + "bb".repeat(32),
  complaint: "partial", deliveryNotes: "d", evidenceNotes: "e",
};
const deps = (client: GeminiLlmClient) => ({ llm: client, store: new SowStore(":memory:"), demoFallback: false, promptVersion: "v1", now: () => 1 });
const declared = (p: GenerateContentParameters) =>
  (p.config?.tools as { functionDeclarations: { parameters: unknown }[] }[])[0].functionDeclarations[0].parameters;

describe("Gemini schema sanitizer", () => {
  it("strips every constraint keyword, recursively, from both tools", () => {
    for (const tool of [MERGE_TOOL, scoreToolFor(sow)]) {
      const keys = allKeys(geminiToolSchema(tool));
      for (const k of STRIPPED_KEYWORDS) expect(keys.has(k), `${tool.name}: ${k}`).toBe(false);
      expect(keys.has("type") && keys.has("properties") && keys.has("required") && keys.has("items")).toBe(true);
    }
  });

  it("restates the bounds in descriptions, and the SOW's deliverable ids for scores", () => {
    const merge = geminiToolSchema(MERGE_TOOL);
    const d = merge.properties!.deliverables;
    expect(d.items!.properties!.weightBps.description).toContain("Integer 1–10000; all weights must sum to exactly 10000.");
    expect(d.description).toContain("At least 1 item. At most 20 items.");
    expect(merge.properties!.exclusions.description).toContain("At most 20 items.");
    expect(merge.properties!.title.description).toContain("At most 200 characters.");

    const score = geminiToolSchema(scoreToolFor(sow));
    expect(score.properties!.scores.description).toContain("Exactly one entry per deliverable id: D1, D2, D3.");
    const item = score.properties!.scores.items!;
    expect(item.properties!.fulfilledPct).toMatchObject({ type: "INTEGER", description: expect.stringContaining("Integer from 0 to 100 inclusive.") });
    expect(item.properties!.evidenceRefs.description).toContain("At most 20 items.");
  });

  it("the Gemini client actually declares the sanitized schema with the SOW's ids", async () => {
    const { client, calls } = gemini(scoresCall([sc("D1", 100), sc("D2", 50), sc("D3", 0)]));
    await scoreDispute(input, deps(client));
    const params = declared(calls[0]);
    for (const k of STRIPPED_KEYWORDS) expect(allKeys(params).has(k)).toBe(false);
    expect(JSON.stringify(params)).toContain("Exactly one entry per deliverable id: D1, D2, D3.");
  });

  it("the original tool definitions keep their full constraints (sanitizer copies, never mutates)", () => {
    geminiToolSchema(SCORE_TOOL);
    expect(JSON.stringify(SCORE_TOOL.input_schema)).toContain('"minimum":0');
    expect(JSON.stringify(MERGE_TOOL.input_schema)).toContain('"additionalProperties":false');
  });
});

describe("zod stays the real enforcement on Gemini output", () => {
  it("fulfilledPct 150 → validation retry → success when corrected", async () => {
    const { client, calls } = gemini(scoresCall([sc("D1", 150), sc("D2", 50), sc("D3", 0)]), scoresCall([sc("D1", 100), sc("D2", 50), sc("D3", 0)]));
    const r = await scoreDispute(input, deps(client));
    expect(calls).toHaveLength(2);
    expect(String(calls[1].contents)).toMatch(/failed validation[\s\S]*fulfilledPct/);
    expect(r.buyerBps).toBe(3500);
  });

  it("fulfilledPct 150 repeated → DisputeScoringError", async () => {
    const { client, calls } = gemini(scoresCall([sc("D1", 150), sc("D2", 50), sc("D3", 0)]));
    const err = await scoreDispute(input, deps(client)).catch((e) => e);
    expect(err).toBeInstanceOf(DisputeScoringError);
    expect(err.issues.join(" ")).toMatch(/fulfilledPct/);
    expect(calls).toHaveLength(2);
  });

  it("an omitted deliverable → retry → error", async () => {
    const { client, calls } = gemini(scoresCall([sc("D1", 100), sc("D2", 50)]));
    const err = await scoreDispute(input, deps(client)).catch((e) => e);
    expect(err).toBeInstanceOf(DisputeScoringError);
    expect(err.issues).toContain('scores: missing deliverable "D3"');
    expect(calls).toHaveLength(2);
  });
});

describe("schema-related 400", () => {
  it('reads "Gemini rejected tool schema: …", is not retried and not failed over', async () => {
    const msg = "The specified schema produces a constraint that has too many states for serving.";
    const { client, calls } = gemini(new ApiError({ status: 400, message: msg }));
    await expect(client.callTool({ system: "s", prompt: "p", tool: SCORE_TOOL })).rejects.toThrow(GeminiSchemaError);
    const err = await scoreDispute(input, deps(client)).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.message).toBe(`Gemini rejected tool schema: ${msg}`);
    expect(calls).toHaveLength(2); // one from the direct call above, one from scoreDispute — no retries
  });
});

describe("Anthropic keeps the full schemas", () => {
  it("sends exactly name/description/input_schema with all bounds, and no constraintNotes", async () => {
    const sent: unknown[] = [];
    const messages = {
      create: async (p: { tools: unknown[] }) => {
        sent.push(p.tools[0]);
        return { stop_reason: "tool_use", content: [{ type: "tool_use", name: "submit_scores", input: { scores: [] } }] };
      },
    } as unknown as AnthropicMessagesApi;
    const tool = scoreToolFor(sow);
    await new AnthropicLlmClient("claude-sonnet-5", "k", messages).callTool({ system: "s", prompt: "p", tool });
    expect(sent[0]).toEqual({ name: SCORE_TOOL.name, description: SCORE_TOOL.description, input_schema: SCORE_TOOL.input_schema });
    const keys = allKeys(sent[0]);
    expect(keys.has("minimum") && keys.has("maximum") && keys.has("maxItems") && keys.has("additionalProperties")).toBe(true);
    expect(keys.has("constraintNotes")).toBe(false);
  });
});
