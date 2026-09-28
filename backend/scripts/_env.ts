// Shared by the scripts: load .env (backend/.env first, then repo-root .env) and track per-attempt call metadata.
// Nothing here prints the key, request headers or prompts.
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmCallInfo, LlmClient } from "../src/agent/llm";
import type { AttemptLog } from "../src/agent/toolRetry";

const here = dirname(fileURLToPath(import.meta.url));
config({ path: [resolve(here, "../.env"), resolve(here, "../../.env")], quiet: true });

export type AttemptRow = LlmCallInfo & { attempt: number; outcome: string };

export function attemptRecorder(llm: LlmClient) {
  const rows: AttemptRow[] = [];
  const onAttempt = (a: AttemptLog) => {
    const info = llm.lastCall;
    llm.lastCall = undefined;
    rows.push({
      attempt: a.attempt,
      forcedToolChoice: info?.forcedToolChoice ?? false,
      toolCalled: info?.toolCalled ?? false,
      stopReason: info?.stopReason ?? "(no response)",
      latencyMs: info?.latencyMs ?? 0,
      outcome: a.error ? `failed: ${a.error.slice(0, 200)}` : "valid",
    });
  };
  const print = () => {
    for (const r of rows) {
      const honoured = r.forcedToolChoice ? (r.toolCalled ? "yes" : "no") : `n/a, auto mode (tool called: ${r.toolCalled ? "yes" : "no"})`;
      console.log(`forced function call honoured: ${honoured} on attempt ${r.attempt}  [stop=${r.stopReason}, ${r.latencyMs} ms, ${r.outcome}]`);
    }
  };
  return { rows, onAttempt, print };
}

export const SAMPLE_PARTIES = {
  buyer: "0x1111111111111111111111111111111111111111",
  seller: "0x2222222222222222222222222222222222222222",
};

export function sampleToken(): string {
  const v = process.env.USD_ADDRESS ?? "";
  return /^0x[0-9a-fA-F]{40}$/.test(v) ? v.toLowerCase() : "0x0000000000000000000000000000000000000001";
}
