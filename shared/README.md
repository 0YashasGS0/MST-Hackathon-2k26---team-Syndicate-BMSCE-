# @kernel-exploits/shared

The code both backend and frontend must run identically: the SOW schema (`sow/v1`), SOW and reasoning hashing
(RFC 8785 → keccak256), the dispute split formula (TS + `split.wasm`), and the ruling verifier.

The published entry point is the **built** `dist/` (ESM `.js` + `.d.ts`), which is committed, so consumers don't need
to build it. Everything reachable from the index is browser-safe (no `fs`/`path`/Node globals; `test/dist.test.ts`
checks this).

## Frontend (Next.js) install

```bash
cd shared && npm ci            # installs shared's own deps (zod, viem, canonicalize) and runs `prepare` (= build)
cd ../frontend && npm install @kernel-exploits/shared@file:../shared
cp ../shared/dist/split.wasm public/split.wasm   # the verify page fetches it from /split.wasm
```

Install `shared/` first: npm links `file:` dependencies without installing their dependencies, and a bundler
resolves `zod`/`viem` from `shared/`'s real path. If `next build` complains about the linked package, add
`transpilePackages: ["@kernel-exploits/shared"]` to `next.config`.

```ts
import { hashSow, hashJson, parseSow, computeBuyerBps, loadSplitWasm, verifyRuling } from "@kernel-exploits/shared";
import type { Sow, Deliverable, Reasoning, AnyReasoning } from "@kernel-exploits/shared";

const wasm = await loadSplitWasm(await (await fetch("/split.wasm")).arrayBuffer());
const result = verifyRuling({ reasoning, onchainReasoningHash, onchainProposedBps, settled, sow, wasm });
```

Never hash a SOW any other way than `hashSow()` (AGENTS.md rule 5); never compute a split outside
`computeBuyerBps()` / `split.wasm` (rule 4).

## Scripts

| Script | What |
|---|---|
| `npm run build` | `tsc -p tsconfig.build.json` → `dist/*.js` + `dist/*.d.ts` (commit the result) |
| `npm run build:wasm` | AssemblyScript → `dist/split.wasm` (commit the result) |
| `npm test` | vitest, including a check that the committed `dist/` equals a fresh build |
| `npm run typecheck` | `tsc --noEmit` over `src/` and `test/` |

Node consumers (backend) read the wasm through the package exports:
`createRequire(import.meta.url).resolve("@kernel-exploits/shared/dist/split.wasm")` (or `.../split.wasm`).
