// Shared by the scripts: load .env (backend/.env first, then repo-root .env) and track per-attempt call metadata.
// Nothing here prints the key, request headers or prompts.
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { labelOf, type LlmCallInfo, type LlmClient } from "../src/agent/llm";
import type { AttemptLog } from "../src/agent/toolRetry";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: [resolve(here, "../.env"), resolve(here, "../../.env")], quiet: true });

/**
 * Records every attempt (validation attempts and transient tries) from AttemptLog + the answering client's lastCall.
 * The forcing mode printed is the client's CONFIGURED mode (never inferred from a failed request).
 */
/** "provider:model" for an attempt (chain entries already carry it; legacy clients get it prefixed here). */
const pm = (a: AttemptLog) => (a.model.startsWith(`${a.provider}:`) ? a.model : `${a.provider}:${a.model}`);

export function attemptRecorder(chain: readonly LlmClient[]) {
  const lines: string[] = [];
  let answeredBy: string | undefined;
  const onAttempt = (a: AttemptLog) => {
    const client = chain.find((c) => labelOf(c) === a.model) ?? chain[0];
    const mode = `mode=${a.toolMode ?? client.toolMode ?? "unknown"}`;
    if (a.transient) {
      lines.push(`attempt ${a.attempt} · ${pm(a)} · status=${a.statusCode ?? "network error"} (transient) · ${mode}, no response`);
      if (a.retryDelayMs !== undefined) lines.push(`cooldown: ${pm(a)} until +${Math.ceil(a.retryDelayMs / 1000)}s (not retried; next model)`);
      return;
    }
    const info: LlmCallInfo | undefined = client.lastCall;
    client.lastCall = undefined;
    if (!info) {
      lines.push(`attempt ${a.attempt} · ${pm(a)} · status=${a.statusCode ?? "?"} · ${mode}, no response: ${a.error?.slice(0, 160) ?? ""}`);
      return;
    }
    const honoured = info.toolCalled ? "yes" : "no";
    const outcome = a.error ? `invalid: ${a.error.slice(0, 160)}` : "valid";
    if (!a.error) answeredBy = pm(a);
    lines.push(
      `attempt ${a.attempt} · ${pm(a)} · status=200 · mode=${info.toolMode ?? client.toolMode} · forced function call honoured: ${honoured} on attempt ${a.attempt} · stop=${info.stopReason} · ${info.latencyMs} ms · ${outcome}`,
    );
  };
  const print = () => {
    for (const l of lines) console.log(l);
    console.log(`answered by: ${answeredBy ?? "(no model produced a valid answer)"}`);
  };
  const header = () => {
    console.log(`chain:    ${chain.map(labelOf).join(" → ")}`);
    for (const c of chain) console.log(`  ${labelOf(c).padEnd(40)} provider=${c.provider} mode=${c.toolMode}`);
  };
  /** Pass as `backoff` so a wait for a cooled-down model is shown too. */
  const backoff = { onCooldownWait: (model: string, ms: number) => lines.push(`all models cooling: waiting ${Math.ceil(ms / 1000)}s for ${model}`) };
  return { onAttempt, print, header, backoff };
}

export const SAMPLE_PARTIES = {
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
};

export function sampleToken(): string {
  const v = process.env.USD_ADDRESS ?? "";
  return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : "0x0000000000000000000000000000000000000001";
}
