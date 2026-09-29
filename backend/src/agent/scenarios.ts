// Demo dispute scenarios (backend/demo/scenarios/*.json), shared by the eval harness and seed:demo.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SowSchema, computeBuyerBps, fulfilledFromCriteria, type Sow, type Verdict } from "@kernel-exploits/shared";

/** Expected range = ground-truth bps ± this. */
export const RANGE_TOLERANCE_BPS = 300;

export const SCENARIOS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../demo/scenarios");

const ScenarioSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    sow: SowSchema,
    deliveryNotes: z.string().min(1),
    complaint: z.string().min(1),
    evidenceNotes: z.string().min(1),
    /** Intended verdict per acceptance criterion (by position = 0-based index), per deliverable id. */
    groundTruth: z.record(
      z.string(),
      z.array(
        z
          .object({ verdict: z.enum(["met", "partial", "not_met"]), satisfied: z.number().int().optional(), total: z.number().int().optional() })
          .strict(),
      ),
    ),
  })
  .strict();

export type GroundTruthVerdict = { verdict: Verdict; satisfied?: number; total?: number };
export type Scenario = Omit<z.infer<typeof ScenarioSchema>, "sow" | "groundTruth"> & {
  sow: Sow;
  groundTruth: Record<string, GroundTruthVerdict[]>;
  /** Computed from groundTruth with the production code path (fulfilledFromCriteria → computeBuyerBps). */
  expectedBps: number;
  /** expectedBps ± RANGE_TOLERANCE_BPS, clamped to 0..10000. */
  expectedBuyerBps: { min: number; max: number };
};

/** Ground-truth buyerBps via the same code the scorer uses. Throws if groundTruth doesn't cover the SOW exactly. */
export function groundTruthBps(sow: Sow, groundTruth: Record<string, GroundTruthVerdict[]>): number {
  const extra = Object.keys(groundTruth).filter((id) => !sow.deliverables.some((d) => d.id === id));
  if (extra.length) throw new Error(`groundTruth has unknown deliverable ids: ${extra.join(", ")}`);
  const scores = sow.deliverables.map((d) => {
    const gt = groundTruth[d.id];
    if (!gt) throw new Error(`groundTruth is missing deliverable ${d.id}`);
    if (gt.length !== d.acceptanceCriteria.length) throw new Error(`groundTruth ${d.id}: ${gt.length} verdicts for ${d.acceptanceCriteria.length} criteria`);
    return { id: d.id, fulfilledPct: fulfilledFromCriteria(gt.map((v, index) => ({ index, ...v })), gt.length) };
  });
  return computeBuyerBps(sow.deliverables, scores);
}

/** All *.json scenarios in `dir`, validated, sorted by id. Throws with the file name on a bad fixture. */
export function loadScenarios(dir: string = SCENARIOS_DIR): Scenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = ScenarioSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`${f}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      let expectedBps: number;
      try {
        expectedBps = groundTruthBps(parsed.data.sow, parsed.data.groundTruth);
      } catch (err) {
        throw new Error(`${f}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return {
        ...parsed.data,
        expectedBps,
        expectedBuyerBps: { min: Math.max(0, expectedBps - RANGE_TOLERANCE_BPS), max: Math.min(10000, expectedBps + RANGE_TOLERANCE_BPS) },
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
