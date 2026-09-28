// Lists Gemini models this key can use with generateContent, newest first. Prints names only (stdout).
// The API does not report function-calling support per model, so by default this lists generateContent models.
// `npm run models -- --probe` additionally sends one tiny forced function call per model and keeps only those
// that return it (one request per model; may hit free-tier rate limits).
import "./_env";
import { FunctionCallingConfigMode, GoogleGenAI, Type } from "@google/genai";

const provider = (process.env.LLM_PROVIDER || "gemini").toLowerCase();
if (provider !== "gemini") {
  console.error(`LLM_PROVIDER is "${provider}"; npm run models only lists Gemini models.`);
  process.exit(1);
}
const apiKey = process.env.LLM_API_KEY;
if (!apiKey) {
  console.error("LLM_API_KEY is not set in .env.");
  process.exit(1);
}
const ai = new GoogleGenAI({ apiKey });
const probe = process.argv.includes("--probe");

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
