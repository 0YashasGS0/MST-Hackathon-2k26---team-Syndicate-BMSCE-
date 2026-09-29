// Gemini-only tool-schema sanitizer. Gemini's function-calling compiler rejects schemas whose numeric/length
// bounds produce "too many states" (400 INVALID_ARGUMENT), e.g. fulfilledPct 0–100 inside an array.
// So for Gemini we strip every validation keyword and restate it in plain words in the field's description.
// zod validation + the retry-once (toolRetry.ts) remain the real enforcement. Anthropic gets the full schema.
import { Type, type Schema } from "@google/genai";
import type { ToolDef } from "./llm";

export const STRIPPED_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "additionalProperties",
] as const;

type Json = Record<string, unknown>;

/**
 * Returns a copy of a JSON Schema with STRIPPED_KEYWORDS removed (recursively). Each field's removed bounds are
 * written into its description; `notes[path]` (e.g. "scores", "deliverables[].weightBps") replaces the generic wording.
 */
export function sanitizeForGemini(schema: Json, notes: Record<string, string> = {}, path = ""): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(schema)) {
    if ((STRIPPED_KEYWORDS as readonly string[]).includes(k)) continue;
    if (k === "properties" && v && typeof v === "object") {
      out.properties = Object.fromEntries(
        Object.entries(v as Record<string, Json>).map(([name, sub]) => [name, sanitizeForGemini(sub, notes, path ? `${path}.${name}` : name)]),
      );
    } else if (k === "items" && v && typeof v === "object") {
      out.items = sanitizeForGemini(v as Json, notes, `${path}[]`);
    } else {
      out[k] = v;
    }
  }
  const words = notes[path] ?? boundsInWords(schema);
  if (words) {
    const base = typeof schema.description === "string" ? schema.description.trim() : "";
    out.description = base ? `${/[.!?]$/.test(base) ? base : `${base}.`} ${words}` : words;
  }
  return out;
}

/** Plain-words version of the validation keywords on one node (not its children). */
function boundsInWords(s: Json): string {
  const n = (k: string) => (typeof s[k] === "number" ? (s[k] as number) : undefined);
  const parts: string[] = [];
  if (s.type === "integer" || s.type === "number") {
    const kind = s.type === "integer" ? "Integer" : "Number";
    const lo = n("minimum"), hi = n("maximum"), xlo = n("exclusiveMinimum"), xhi = n("exclusiveMaximum");
    if (lo !== undefined && hi !== undefined) parts.push(`${kind} from ${lo} to ${hi} inclusive.`);
    else if (lo !== undefined) parts.push(`${kind}, at least ${lo}.`);
    else if (hi !== undefined) parts.push(`${kind}, at most ${hi}.`);
    if (xlo !== undefined) parts.push(`Greater than ${xlo}.`);
    if (xhi !== undefined) parts.push(`Less than ${xhi}.`);
  }
  if (n("minItems") !== undefined) parts.push(`At least ${n("minItems")} item${n("minItems") === 1 ? "" : "s"}.`);
  if (n("maxItems") !== undefined) parts.push(`At most ${n("maxItems")} items.`);
  if (n("minLength") !== undefined) parts.push(`At least ${n("minLength")} character${n("minLength") === 1 ? "" : "s"}.`);
  if (n("maxLength") !== undefined) parts.push(`At most ${n("maxLength")} characters.`);
  if (typeof s.pattern === "string") parts.push(`Must match the regular expression ${s.pattern}.`);
  if (typeof s.format === "string") parts.push(`Format: ${s.format}.`);
  return parts.join(" ");
}

/** The exact `parameters` schema the Gemini client declares for a tool. */
export function geminiToolSchema(tool: ToolDef): Schema {
  return toGeminiSchema(sanitizeForGemini(tool.input_schema as Json, tool.constraintNotes));
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
 * JSON Schema → Gemini Schema type conversion (an OpenAPI 3.0 subset, see `Schema` in @google/genai).
 * Maps the fields the SDK type supports and drops the rest. The Gemini client always runs sanitizeForGemini()
 * first (see geminiToolSchema), so in practice no bounds reach Gemini.
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
