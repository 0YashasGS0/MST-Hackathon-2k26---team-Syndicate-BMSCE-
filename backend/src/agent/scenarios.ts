// Demo dispute scenarios (backend/demo/scenarios/*.json), shared by the eval harness and seed:demo.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SowSchema, type Sow } from "@kernel-exploits/shared";

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
    expectedBuyerBps: z
      .object({ min: z.number().int().min(0).max(10000), max: z.number().int().min(0).max(10000) })
      .refine((r) => r.min <= r.max, "min must be <= max"),
  })
  .strict();

export type Scenario = Omit<z.infer<typeof ScenarioSchema>, "sow"> & { sow: Sow };

/** All *.json scenarios in `dir`, validated, sorted by id. Throws with the file name on a bad fixture. */
export function loadScenarios(dir: string = SCENARIOS_DIR): Scenario[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      const parsed = ScenarioSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
      if (!parsed.success) throw new Error(`${f}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
      return parsed.data;
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
