// SOW (Statement of Work) schema — DRAFT v1.
// Source of truth for the shape both parties hash and commit on-chain.
// Pending reconciliation with docs/MVP.md + docs/API.md (not yet in repo).
import { z } from "zod";

export const SOW_VERSION = "sow/v1" as const;
export const TOTAL_BPS = 10_000;

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");
// Token amounts are base-unit integer strings (MockUSD = 6 decimals) — never JS floats,
// so canonical JSON and on-chain uint256 always agree.
const baseUnits = z.string().regex(/^(0|[1-9][0-9]*)$/, "must be a non-negative integer string");

export const DeliverableSchema = z.object({
  id: z.string().min(1).max(32),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  acceptanceCriteria: z.array(z.string().min(1).max(500)).min(1),
  weightBps: z.number().int().min(1).max(TOTAL_BPS),
});

export const SowSchema = z
  .object({
    version: z.literal(SOW_VERSION),
    title: z.string().min(1).max(200),
    buyer: address,
    seller: address,
    token: address,
    amount: baseUnits,
    deliveryDeadline: z.number().int().positive(), // unix seconds
    reviewWindowSecs: z.number().int().positive(),
    deliverables: z.array(DeliverableSchema).min(1).max(20),
  })
  .strict()
  .superRefine((sow, ctx) => {
    const sum = sow.deliverables.reduce((s, d) => s + d.weightBps, 0);
    if (sum !== TOTAL_BPS) {
      ctx.addIssue({ code: "custom", path: ["deliverables"], message: `weightBps must sum to ${TOTAL_BPS}, got ${sum}` });
    }
    const ids = new Set(sow.deliverables.map((d) => d.id));
    if (ids.size !== sow.deliverables.length) {
      ctx.addIssue({ code: "custom", path: ["deliverables"], message: "deliverable ids must be unique" });
    }
    if (sow.buyer.toLowerCase() === sow.seller.toLowerCase()) {
      ctx.addIssue({ code: "custom", path: ["seller"], message: "buyer and seller must differ" });
    }
  });

export type Deliverable = z.infer<typeof DeliverableSchema>;
export type Sow = z.infer<typeof SowSchema>;

export function parseSow(input: unknown): Sow {
  return SowSchema.parse(input);
}
