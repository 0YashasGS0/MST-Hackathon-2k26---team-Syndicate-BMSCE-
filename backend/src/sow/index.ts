// PLACEHOLDER for B2's module (branch `yashas`), so B1's branch runs on its own. Replaced wholesale by B2's real
// backend/src/sow/index.ts at merge — keep the exported names/signatures in sync with docs/progress/B2.md "Merge notes".
import { Router, type Request } from "express";

export type GetCaller = (req: Request) => string | null;
export type DealSow = { sow: { title: string; [k: string]: unknown }; sowHash: string; draftId: string; version: number };

export class SowStore {
  constructor(_db?: unknown) {}
  /** Real: the agreed SOW of the draft linked to the deal, or null. */
  getSowForDeal(_dealId: number | string | bigint): DealSow | null {
    return null;
  }
  /** Real: stores the ruling and returns hashJson(reasoning). */
  saveRuling(_reasoning: { dealId: number; sowHash: string; buyerBps: number; [k: string]: unknown }, _now?: number): `0x${string}` {
    throw new Error("B2's SowStore is not merged yet");
  }
  getRuling(_reasoningHash: string): unknown {
    return undefined;
  }
}

export const createSowRouter = (_deps: { store?: SowStore; getCaller?: GetCaller; isAuthorizedSigner?: unknown }) => Router();
export const createDisputeRouter = (_deps: { store?: SowStore; getCaller?: GetCaller }) => Router();
