// Shared "call the tool, validate, retry once with the errors appended" loop for every agent task.
import { LlmOutputError, labelOf, type LlmClient, type ToolDef } from "./llm";
import { AllModelsFailedError, AllModelsRateLimitedError, ModelCallError, callWithFallback, statusOf, type BackoffOptions } from "./resilience";

export const MAX_ATTEMPTS = 2; // first try + one retry

export type Validated<T> = { ok: true; value: T } | { ok: false; issues: string[] };
export type AttemptLog = {
  attempt: number; // validation attempt (1 or 2)
  provider: string;
  model: string; // the model this row is about (for a valid answer: the model that actually answered)
  request: unknown;
  response?: unknown;
  error?: string;
  statusCode?: number | null; // HTTP status for transient failures (null = network error)
  transient?: boolean; // true = 429/500/503/network try, handled by backoff/fallback, not by the validation retry
  retryDelayMs?: number; // 429 only: the model's cooldown
  toolMode?: string; // how the tool call was forced for this client (e.g. named vs "required")
};

/** A single client, or a chain: primary first, then fallbacks (LLM_FALLBACK_MODELS). */
export type LlmChain = LlmClient | readonly LlmClient[];
export const chainOf = (llm: LlmChain): readonly LlmClient[] => (Array.isArray(llm) ? llm : [llm as LlmClient]);
export const primaryOf = (llm: LlmChain): LlmClient => chainOf(llm)[0];

/** Output never validated after MAX_ATTEMPTS. */
export class AgentValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`agent output failed validation after ${MAX_ATTEMPTS} attempts`);
  }
}
/** The LLM API itself failed (network, auth, 5xx) or no client is configured. */
export class LlmUnavailableError extends Error {}

export async function callToolWithRetry<T>(opts: {
  llm: LlmChain;
  system: string;
  prompt: string;
  tool: ToolDef;
  validate: (raw: unknown) => Validated<T>;
  onAttempt?: (a: AttemptLog) => void;
  backoff?: BackoffOptions;
}): Promise<{ value: T; provider: string; model: string }> {
  const { system, tool } = opts;
  const chain = chainOf(opts.llm);
  const who = (c: LlmClient) => ({ provider: c.provider ?? "unknown", model: labelOf(c), ...(c.toolMode && { toolMode: c.toolMode }) });
  let issues: string[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const prompt =
      attempt === 1
        ? opts.prompt
        : `${opts.prompt}\n\nYour previous submission failed validation:\n${issues.map((i) => `- ${i}`).join("\n")}\nFix these problems and call ${tool.name} again.`;
    const request = { system, prompt, tool: tool.name };

    let raw: unknown;
    let answered: LlmClient;
    try {
      ({ raw, client: answered } = await callWithFallback(
        chain,
        { system, prompt, tool },
        (t) =>
          opts.onAttempt?.({
            attempt,
            ...who(t.client),
            request,
            error:
              t.retryDelayMs !== undefined
                ? `rate limited (429): cooldown ${Math.ceil(t.retryDelayMs / 1000)}s, not retried on this model: ${t.error}`
                : `transient try ${t.try}: ${t.error}`,
            statusCode: t.statusCode,
            transient: true,
            ...(t.retryDelayMs !== undefined && { retryDelayMs: t.retryDelayMs }),
          }),
        opts.backoff,
      ));
    } catch (err) {
      if (err instanceof AllModelsFailedError || err instanceof AllModelsRateLimitedError) throw new LlmUnavailableError(err.message);
      const failed = err instanceof ModelCallError ? err.client : chain[0];
      const cause = err instanceof ModelCallError ? err.cause : err;
      const msg = cause instanceof Error ? cause.message : String(cause);
      if (cause instanceof LlmOutputError) {
        // The model answered but without the forced call; counts toward the validation retry.
        opts.onAttempt?.({ attempt, ...who(failed), request, error: msg });
        issues = [msg];
        continue;
      }
      opts.onAttempt?.({ attempt, ...who(failed), request, error: msg, statusCode: statusOf(cause) });
      throw new LlmUnavailableError(msg); // non-transient (e.g. 400): no retry, no fallback
    }

    const v = opts.validate(raw);
    opts.onAttempt?.({ attempt, ...who(answered), request, response: raw, ...(v.ok ? {} : { error: v.issues.join("; ") }) });
    if (v.ok) return { value: v.value, provider: answered.provider ?? "unknown", model: labelOf(answered) };
    issues = v.issues;
  }
  throw new AgentValidationError(issues);
}

/** Wrap party-written text so it cannot close the <data> block early. */
export function escapeData(s: string): string {
  return s.replace(/<\/?data\b/gi, (m) => m.replace("<", "&lt;"));
}
