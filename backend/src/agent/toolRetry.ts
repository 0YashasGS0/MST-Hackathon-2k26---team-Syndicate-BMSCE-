// Shared "call the tool, validate, retry once with the errors appended" loop for every agent task.
import { LlmOutputError, type LlmClient, type ToolDef } from "./llm";

export const MAX_ATTEMPTS = 2; // first try + one retry

export type Validated<T> = { ok: true; value: T } | { ok: false; issues: string[] };
export type AttemptLog = { attempt: number; model: string; request: unknown; response?: unknown; error?: string };

/** Output never validated after MAX_ATTEMPTS. */
export class AgentValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`agent output failed validation after ${MAX_ATTEMPTS} attempts`);
  }
}
/** The LLM API itself failed (network, auth, 5xx) or no client is configured. */
export class LlmUnavailableError extends Error {}

export async function callToolWithRetry<T>(opts: {
  llm: LlmClient;
  system: string;
  prompt: string;
  tool: ToolDef;
  validate: (raw: unknown) => Validated<T>;
  onAttempt?: (a: AttemptLog) => void;
}): Promise<T> {
  const { llm, system, tool } = opts;
  let issues: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 1
        ? opts.prompt
        : `${opts.prompt}\n\nYour previous submission failed validation:\n${issues.map((i) => `- ${i}`).join("\n")}\nFix these problems and call ${tool.name} again.`;
    const request = { system, prompt, tool: tool.name };

    let raw: unknown;
    try {
      raw = await llm.callTool({ system, prompt, tool });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.onAttempt?.({ attempt, model: llm.model, request, error: msg });
      if (err instanceof LlmOutputError) {
        issues = [msg];
        continue;
      }
      throw new LlmUnavailableError(msg);
    }

    const v = opts.validate(raw);
    opts.onAttempt?.({ attempt, model: llm.model, request, response: raw, ...(v.ok ? {} : { error: v.issues.join("; ") }) });
    if (v.ok) return v.value;
    issues = v.issues;
  }
  throw new AgentValidationError(issues);
}

/** Wrap party-written text so it cannot close the <data> block early. */
export function escapeData(s: string): string {
  return s.replace(/<\/?data\b/gi, (m) => m.replace("<", "&lt;"));
}
