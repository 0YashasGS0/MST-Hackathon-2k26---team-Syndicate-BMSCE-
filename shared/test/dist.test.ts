// The published build (dist/) is what backend and frontend import. These tests check it is fresh, importable from
// plain Node ESM (no TS loader, no bundler), and browser-safe (nothing reachable from index imports a Node builtin).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const TSC = join(ROOT, "node_modules", ".bin", "tsc");

describe("shared dist build", () => {
  it("builds, and the committed dist/ equals a fresh build of src/", () => {
    const out = mkdtempSync(join(tmpdir(), "shared-dist-"));
    try {
      execFileSync(TSC, ["-p", "tsconfig.build.json", "--outDir", out], { cwd: ROOT, stdio: "pipe" });
      const built = readdirSync(out).sort();
      expect(built).toContain("index.js");
      expect(built).toContain("index.d.ts");
      for (const f of built) expect(readFileSync(join(DIST, f), "utf8"), `dist/${f} is stale: run npm run build`).toBe(readFileSync(join(out, f), "utf8"));
      expect(readdirSync(DIST)).toContain("split.wasm");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it("imports from plain Node ESM by package name, and split.wasm resolves through exports", () => {
    const script = `
      import { readFileSync } from "node:fs";
      import { fileURLToPath } from "node:url";
      import * as s from "@kernel-exploits/shared";
      const sow = { version: "sow/v1", title: "t", buyer: "0x${"1".repeat(40)}", seller: "0x${"2".repeat(40)}",
        token: "0x${"3".repeat(40)}", amount: "100", deliveryDeadline: 1, reviewWindowSecs: 1,
        deliverables: [{ id: "D1", title: "d", description: "", acceptanceCriteria: ["c"], weightBps: 10000 }], exclusions: [] };
      const wasm = await s.loadSplitWasm(readFileSync(fileURLToPath(import.meta.resolve("@kernel-exploits/shared/split.wasm"))));
      const sowHash = s.hashSow(s.parseSow(sow));
      const arb = { source: "arbitrator", dealId: 1, sowHash, buyerBps: 2500, ruling: "r" };
      const v = s.verifyRuling({ reasoning: arb, onchainReasoningHash: s.hashJson(arb), sow, settled: { toBuyer: 25n, amount: 100n }, wasm });
      console.log(JSON.stringify({
        fns: ["hashSow", "hashJson", "parseSow", "computeBuyerBps", "loadSplitWasm", "verifyRuling"].map((k) => typeof s[k]),
        bps: s.computeBuyerBps(sow.deliverables, [{ id: "D1", fulfilledPct: 40 }]),
        wasmBps: wasm.computeBuyerBps(sow.deliverables, [{ id: "D1", fulfilledPct: 40 }]),
        ok: v.ok,
      }));`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, encoding: "utf8" });
    expect(JSON.parse(out)).toEqual({ fns: Array(6).fill("function"), bps: 6000, wasmBps: 6000, ok: true });
  });

  it("is browser-safe: no module reachable from dist/index.js imports a Node builtin", () => {
    const seen = new Set<string>();
    const visit = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const src = readFileSync(join(DIST, file), "utf8");
      for (const [, spec] of src.matchAll(/(?:import|export)[^"']*?from\s*["']([^"']+)["']/g)) {
        expect(spec, `${file} imports ${spec}`).not.toMatch(/^node:|^(fs|path|os|url|crypto|child_process|module|buffer|stream)$/);
        if (spec.startsWith("./")) visit(spec.slice(2));
      }
      const code = src.replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${file} uses a Node global`).not.toMatch(/\b(process\.|require\(|Buffer\.|__dirname)/);
    };
    visit("index.js");
    expect([...seen].sort()).toEqual(["hash.js", "index.js", "sow.js", "split.js", "splitWasm.js", "verify.js"]);
  });

  it("exports the FE types from index.d.ts", () => {
    const dts = readdirSync(DIST).filter((f) => f.endsWith(".d.ts")).map((f) => readFileSync(join(DIST, f), "utf8")).join("\n");
    for (const t of ["type Sow ", "type Deliverable ", "type Reasoning ", "type ArbitratorReasoning ", "type AnyReasoning "]) expect(dts).toContain(t);
  });
});
