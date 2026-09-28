// Transient-error resilience for LLM calls, separate from the validation retry-once in toolRetry.ts.
//  - 500 / 503 / network: per-model exponential backoff (3 tries), then the next fallback model.
//  - 429 (rate limit): never retry the same model. Put it on cooldown for its retryDelay and move straight to the
//    next model; cooled-down models are skipped on later calls. If every model is cooling, wait once for the
//    earliest (≤ LLM_MAX_COOLDOWN_WAIT_MS, default 65 s) and retry it, otherwise fail fast.
import { labelOf, type LlmClient, type ToolCallRequest } from "./llm";

export type BackoffOptions = {
  attemptsPerModel?: number; // default 3
  baseDelayMs?: number; // default 1000 → waits ~1 s, ~2 s (next would be ~4 s)
  maxTotalSleepMs?: number; // default 10_000, across all models in one call
  sleep?: (ms: number) => Promise<void>; // injectable for tests
  random?: () => number; // injectable for tests (jitter)
  cooldowns?: ModelCooldowns; // default: process-wide registry
  now?: () => number; // ms clock for cooldowns; injectable for tests
  maxCooldownWaitMs?: number; // default env LLM_MAX_COOLDOWN_WAIT_MS || 65000
  onCooldownWait?: (model: string, ms: number) => void;
};

export type TransientEvent = {
  client: LlmClient;
  try: number;
  statusCode: number | null;
  error: string;
  /** 429 only: the retryDelay used for this model's cooldown. */
  retryDelayMs?: number;
};

/** Used when a 429 carries no RetryInfo (Gemini free-tier quotas are per minute). */
export const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 60_000;

/**
 * "Model X is rate-limited until T". Keyed by client instance: production creates one client per model and reuses it
 * (router / agent index / scripts), so this is per model; tests get isolation for free with fresh mock clients.
 */
export class ModelCooldowns {
  private readonly until = new WeakMap<LlmClient, number>();
  get(c: LlmClient): number | undefined {
    return this.until.get(c);
  }
  set(c: LlmClient, untilMs: number): void {
    this.until.set(c, untilMs);
  }
  clear(c: LlmClient): void {
    this.until.delete(c);
  }
}
const defaultCooldowns = new ModelCooldowns();

/** Every model is cooling down after 429s and the earliest expiry is too far away to wait for. */
export class AllModelsRateLimitedError extends Error {
  constructor(readonly earliestMs: number, cooling: { model: string; inMs: number }[]) {
    super(
      `all models rate-limited; earliest retry in ${Math.ceil(earliestMs / 1000)}s (${cooling
        .map((c) => `${c.model} +${Math.ceil(c.inMs / 1000)}s`)
        .join(", ")})`,
    );
  }
}

/**
 * Retry delay from an error message, in ms: Gemini's RetryInfo (`"retryDelay": "23s"`) or Groq/OpenAI-style
 * "Please try again in 7.66s" / "in 1m2.5s" / "in 450ms".
 */
export function retryDelayMsFrom(message: string): number | null {
  const g = message.match(/"?retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)s"?/);
  if (g) return Math.round(Number(g[1]) * 1000);
  const o = message.match(/try again in\s+(?:(\d+)m)?(\d+(?:\.\d+)?)(ms|s)\b/i);
  if (o) return Math.round((Number(o[1] ?? 0) * 60 + Number(o[2]) / (o[3] === "ms" ? 1000 : 1)) * 1000);
  return null;
}

/** Retry delay of a 429: the `retry-after` header (seconds), else the message. */
export function retryDelayOf(err: unknown): number | null {
  const h = (err as { headers?: { get?: (k: string) => string | null } } | null)?.headers;
  const ra = typeof h?.get === "function" ? h.get("retry-after") : null;
  if (ra && /^\d+(\.\d+)?$/.test(ra.trim())) return Math.round(Number(ra) * 1000);
  return retryDelayMsFrom(err instanceof Error ? err.message : String(err));
}

/** Every model in the chain failed with transient errors (or the sleep budget ran out). */
export class AllModelsFailedError extends Error {
  constructor(readonly failures: { model: string; statuses: (number | null)[] }[]) {
    super(
      `all LLM models failed: ${failures
        .map((f) => `${f.model} (${f.statuses.length ? f.statuses.map((s) => s ?? "network error").join(", ") : "skipped: rate-limited"})`)
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
  const cooldowns = opts.cooldowns ?? defaultCooldowns;
  const now = opts.now ?? Date.now;
  const maxWait = opts.maxCooldownWaitMs ?? Number(process.env.LLM_MAX_COOLDOWN_WAIT_MS || 65_000);

  let slept = 0;
  const failures: { model: string; statuses: (number | null)[] }[] = [];

  /** One model: 500/503/network → backoff retries; 429 → cooldown, give up on this model immediately. */
  async function tryModel(client: LlmClient): Promise<{ raw: unknown } | null> {
    const statuses: (number | null)[] = [];
    failures.push({ model: labelOf(client), statuses });
    for (let t = 1; t <= attempts; t++) {
      try {
        return { raw: await client.callTool(req) };
      } catch (err) {
        if (!isTransient(err)) throw new ModelCallError(client, err);
        const statusCode = statusOf(err);
        const error = err instanceof Error ? err.message : String(err);
        statuses.push(statusCode);
        if (statusCode === 429) {
          const retryDelayMs = retryDelayOf(err) ?? DEFAULT_RATE_LIMIT_COOLDOWN_MS;
          cooldowns.set(client, now() + retryDelayMs);
          onTransient?.({ client, try: t, statusCode, error, retryDelayMs });
          return null; // never retry a rate-limited model; the next one gets its turn
        }
        onTransient?.({ client, try: t, statusCode, error });
        if (t === attempts) break; // move on to the next model without waiting
        // ~base·2^(t-1) with ±25% jitter, never exceeding the remaining sleep budget.
        const delay = Math.min(Math.round(base * 2 ** (t - 1) * (0.75 + random() * 0.5)), budget - slept);
        if (delay <= 0) break;
        await sleep(delay);
        slept += delay;
      }
    }
    return null;
  }

  const coolingIn = (c: LlmClient) => {
    const until = cooldowns.get(c);
    return until !== undefined && until > now() ? until - now() : 0;
  };

  for (const client of chain) {
    if (coolingIn(client) > 0) {
      failures.push({ model: labelOf(client), statuses: [] }); // rate-limited recently: skip without a request
      continue;
    }
    const r = await tryModel(client);
    if (r) return { raw: r.raw, client };
  }

  // Every model cooling down? Wait once for the earliest if it's close enough, else fail fast.
  if (chain.every((c) => coolingIn(c) > 0)) {
    const cooling = chain.map((c) => ({ client: c, model: labelOf(c), inMs: coolingIn(c) })).sort((a, b) => a.inMs - b.inMs);
    const first = cooling[0];
    if (first.inMs > maxWait) throw new AllModelsRateLimitedError(first.inMs, cooling);
    opts.onCooldownWait?.(first.model, first.inMs);
    await sleep(first.inMs);
    cooldowns.clear(first.client);
    const r = await tryModel(first.client);
    if (r) return { raw: r.raw, client: first.client };
    if (chain.every((c) => coolingIn(c) > 0)) {
      const again = chain.map((c) => ({ model: labelOf(c), inMs: coolingIn(c) })).sort((a, b) => a.inMs - b.inMs);
      throw new AllModelsRateLimitedError(again[0].inMs, again);
    }
  }
  throw new AllModelsFailedError(failures);
}
