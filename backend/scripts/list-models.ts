// Lists models for a provider. Prints names only (stdout); notes go to stderr. Never prints keys.
//   npm run models                      → Gemini (LLM_PROVIDER, default gemini): generateContent models, newest first
//   npm run models -- --provider groq   → Groq chat models (GET /models), newest first   (also: openrouter)
//   add --probe to send one tiny forced tool/function call per model and report which honour it
//   (Gemini: keeps only models that honour it; Groq/OpenRouter: 3 s apart, prints "model  named|required|no|error").
import "./_env";
import { FunctionCallingConfigMode, GoogleGenAI, Type } from "@google/genai";
import OpenAI from "openai";
import { LlmOutputError, type ToolDef } from "../src/agent/llm";
import { OPENAI_COMPAT_PROVIDERS, OpenAICompatClient, type OpenAICompatProvider } from "../src/agent/openaiCompatClient";

const argProvider = (() => {
  const i = process.argv.indexOf("--provider");
  return i >= 0 ? process.argv[i + 1] : undefined;
})();
const provider = (argProvider || process.env.LLM_PROVIDER || "gemini").toLowerCase();
const probe = process.argv.includes("--probe");

if (provider === "groq" || provider === "openrouter") {
  await listOpenAICompat(provider);
  process.exit(0);
}
if (provider !== "gemini") {
  console.error(`--provider must be gemini, groq or openrouter (got "${provider}")`);
  process.exit(1);
}

const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY (or LLM_API_KEY) is not set in .env.");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });

const names: string[] = [];
for await (const m of await ai.models.list({ config: { pageSize: 100, queryBase: true } })) {
  if (m.name && m.supportedActions?.includes("generateContent")) names.push(m.name.replace(/^models\//, ""));
}

// "Newest first": the API has no release date, so order by the version in the name (gemini-3.1 > gemini-2.5),
// then stable before preview/experimental, then alphabetically.
const version = (n: string) => {
  const m = n.match(/gemini-(\d+)(?:\.(\d+))?/);
  return m ? Number(m[1]) * 1000 + Number(m[2] ?? 0) : -1;
};
const unstable = (n: string) => (/preview|exp/.test(n) ? 1 : 0);
names.sort((a, b) => version(b) - version(a) || unstable(a) - unstable(b) || a.localeCompare(b));

let out = names;
if (probe) {
  out = [];
  for (const model of names) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: "Call ping with ok=true.",
        config: {
          maxOutputTokens: 64,
          tools: [{ functionDeclarations: [{ name: "ping", parameters: { type: Type.OBJECT, properties: { ok: { type: Type.BOOLEAN } }, required: ["ok"] } }] }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["ping"] } },
        },
      });
      if (res.functionCalls?.some((c) => c.name === "ping")) out.push(model);
    } catch {
      // model rejected function calling (or rate-limited): leave it out
    }
  }
} else {
  console.error("(generateContent models; add `-- --probe` to verify function calling per model)");
}
for (const n of out) console.log(n);

async function listOpenAICompat(p: OpenAICompatProvider): Promise<void> {
  const { baseURL, keyEnv } = OPENAI_COMPAT_PROVIDERS[p];
  const key = process.env[keyEnv];
  if (!key) {
    console.error(`${keyEnv} is not set in .env.`);
    process.exit(1);
  }
  const client = new OpenAI({ apiKey: key, baseURL, maxRetries: 0 });
  const models: { id: string; created: number }[] = [];
  for await (const m of client.models.list()) models.push({ id: m.id, created: m.created ?? 0 });
  // Groq's /models also returns speech, TTS and guard models; keep chat models only (heuristic on the id).
  const NOT_CHAT = /whisper|tts|playai|orpheus|guard|distil|embed/i;
  const chat = models.filter((m) => !NOT_CHAT.test(m.id)).sort((a, b) => b.created - a.created || a.id.localeCompare(b.id));

  if (!probe) {
    console.error(`(${p} chat models, newest first; add \`-- --probe\` to test forced tool calls)`);
    for (const m of chat) console.log(m.id);
    return;
  }
  const PING: ToolDef = {
    name: "ping",
    description: "Acknowledge.",
    input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  };
  console.error(`(probing ${chat.length} ${p} models, 3 s apart)`);
  for (const [i, m] of chat.entries()) {
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));
    const c = new OpenAICompatClient(p, m.id, key);
    let verdict: string;
    try {
      await c.callTool({ system: "You are a test.", prompt: "Call ping with ok=true.", tool: PING });
      verdict = c.toolMode.startsWith("tool_choice=function") ? "named" : "required";
    } catch (err) {
      const status = (err as { status?: number }).status;
      verdict = err instanceof LlmOutputError ? "no" : `error${status ? ` ${status}` : ""}`;
    }
    console.log(`${m.id.padEnd(50)} ${verdict}`);
  }
}
