// Transient-error resilience for LLM calls: per-model exponential backoff, then fallback models in order.
// Separate from the validation retry-once in toolRetry.ts — transient failures never consume that retry.
import type { LlmClient, ToolCallRequest } from "./llm";

export type BackoffOptions = {
  attemptsPerModel?: number; // default 3
  baseDelayMs?: number; // default 1000 → waits ~1 s, ~2 s (next would be ~4 s)
  maxTotalSleepMs?: number; // default 10_000, across all models in one call
  sleep?: (ms: number) => Promise<void>; // injectable for tests
  random?: () => number; // injectable for tests (jitter)
};

export type TransientEvent = { client: LlmClient; try: number; statusCode: number | null; error: string };

/** Every model in the chain failed with transient errors (or the sleep budget ran out). */
export class AllModelsFailedError extends Error {
  constructor(readonly failures: { model: string; statuses: (number | null)[] }[]) {
    super(
      `all LLM models failed: ${failures
        .map((f) => `${f.model} (${f.statuses.map((s) => s ?? "network error").join(", ")})`)
        .join("; ")}`,
    );
  }
}

/** A non-transient failure from one specific model in the chain (e.g. 400, or no forced call). */
export class ModelCallError extends Error {
  constructor(
    readonly client: LlmClient,
    readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
  }
}

const TRANSIENT_STATUS = new Set([429, 500, 503]);
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

/** HTTP status of an SDK error (Gemini ApiError / Anthropic APIError both expose `status`). */
export function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === "number" ? s : null;
}

/** 429 / 500 / 503, or a network-level failure (no HTTP response at all). */
export function isTransient(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== null) return TRANSIENT_STATUS.has(status);
  if (!(err instanceof Error)) return false;
  if (["APIConnectionError", "APIConnectionTimeoutError", "FetchError"].includes(err.name) || err.constructor.name === "APIConnectionError") return true;
  const code = (err as { code?: unknown; cause?: { code?: unknown } }).code ?? (err as { cause?: { code?: unknown } }).cause?.code;
  if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
  return err instanceof TypeError && /fetch failed|network/i.test(err.message);
}

/**
 * Calls the chain in order. Per model: up to `attemptsPerModel` tries on transient errors with exponential
 * backoff + jitter. Non-transient errors (400, LlmOutputError, …) are rethrown immediately as ModelCallError
 * (wrapping the original, with the client that raised it) — no retry, no fallback.
 * Returns the raw tool arguments and the client that actually answered.
 */
export async function callWithFallback(
  chain: readonly LlmClient[],
  req: ToolCallRequest,
  onTransient?: (e: TransientEvent) => void,
  opts: BackoffOptions = {},
): Promise<{ raw: unknown; client: LlmClient }> {
  if (chain.length === 0) throw new Error("callWithFallback: empty model chain");
  const attempts = opts.attemptsPerModel ?? 3;
  const base = opts.baseDelayMs ?? 1000;
  const budget = opts.maxTotalSleepMs ?? 10_000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;

  let slept = 0;
  const failures: { model: string; statuses: (number | null)[] }[] = [];
  for (const client of chain) {
    const statuses: (number | null)[] = [];
    failures.push({ model: client.model, statuses });
    for (let t = 1; t <= attempts; t++) {
      try {
        return { raw: await client.callTool(req), client };
      } catch (err) {
        if (!isTransient(err)) throw new ModelCallError(client, err);
        const statusCode = statusOf(err);
        statuses.push(statusCode);
        onTransient?.({ client, try: t, statusCode, error: err instanceof Error ? err.message : String(err) });
        if (t === attempts) break; // move on to the next model without waiting
        // ~base·2^(t-1) with ±25% jitter, never exceeding the remaining sleep budget.
        const delay = Math.min(Math.round(base * 2 ** (t - 1) * (0.75 + random() * 0.5)), budget - slept);
        if (delay <= 0) break;
        await sleep(delay);
        slept += delay;
      }
    }
  }
  throw new AllModelsFailedError(failures);
}
