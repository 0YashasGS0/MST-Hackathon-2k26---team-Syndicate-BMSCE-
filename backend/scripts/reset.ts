// Hour 8-10 — "Add a reset script that re-seeds from scratch in under 2 minutes."
// Wipes the local SQLite DB (chain state on the contract can't be reset without
// redeploying, so this clears OUR side and re-backfills from DEPLOY_BLOCK, then
// re-runs seed.ts). Run with: npx tsx scripts/reset.ts
import "dotenv/config";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const DATA_DIR = path.join(__dirname, "..", "data");

function main() {
  console.log("[reset] wiping local data/ (SQLite DB + uploaded files)...");
  if (fs.existsSync(DATA_DIR)) {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }
  console.log("[reset] local state cleared.");

  console.log("[reset] re-seeding demo deals...");
  execSync("npx tsx scripts/seed.ts", { stdio: "inherit", cwd: path.join(__dirname, "..") });

  console.log("[reset] done. Restart the server (npm run dev) to rebuild the indexer's view.");
}

main();
