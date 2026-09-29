// PLACEHOLDER for B2's dispute agent (branch `yashas`); replaced wholesale by B2's real backend/src/agent/index.ts at merge.
export class DisputeScoringError extends Error {
  issues: string[] = [];
}
export class DemoFallbackError extends Error {}
export class LlmUnavailableError extends Error {}

export type DisputeInput = {
  dealId: number;
  sow: unknown;
  sowHash: string;
  deliveryHash: string;
  evidenceHash: string;
  complaint: string;
  deliveryNotes: string;
  evidenceNotes: string;
};
export type Ruling = { scores: unknown[]; buyerBps: number; reasoningHash: `0x${string}`; model: string; promptVersion: string };

export async function scoreDispute(_input: DisputeInput, _deps: { store?: unknown } = {}): Promise<Ruling> {
  throw new LlmUnavailableError("B2's dispute agent is not merged yet");
}
