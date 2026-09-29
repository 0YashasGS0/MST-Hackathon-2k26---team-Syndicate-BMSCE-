import { Router } from "express";
import path from "path";
import fs from "fs";
import { getAddress } from "viem";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { db } from "../db.js";
import { org, escrowAbi, ESCROW, sendContractTx } from "../chain.js";
import { getCaller, requireApiKey } from "../auth.js";
import { requireAdminToken, safeUpload } from "../security.js";

function requireSignedIn(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const caller = getCaller(req)?.toLowerCase();
  if (!caller) return void res.status(401).json({ error: { code: "Unauthorized", message: "sign in first" } });
  res.locals.caller = caller;
  next();
}
import { gasDripAddress } from "../pg.js";

export const kycRouter = Router();

const UPLOAD_DIR = path.join(__dirname, "..", "..", "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = safeUpload(UPLOAD_DIR); // size/count/type limits, random file names

// POST /kyc/submit -- save the mock KYC doc for the SIGNED-IN wallet, kyc_level = max(current, 1).
// The address is the session's (PG getCaller); a different `address` field is rejected, so nobody can submit for someone else.
kycRouter.post("/kyc/submit", requireApiKey, requireSignedIn, upload.single("file"), (req, res) => {
  const caller = res.locals.caller as string;
  const claimed = typeof req.body?.address === "string" ? req.body.address.toLowerCase() : caller;
  if (claimed !== caller || !req.file) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    return void res.status(claimed !== caller ? 403 : 400).json({
      error: claimed !== caller
        ? { code: "Forbidden", message: "you can only submit KYC for your own wallet" }
        : { code: "BadRequest", message: "file is required" },
    });
  }
  db.prepare(
    `INSERT INTO users (address, kyc_level) VALUES (?, 1)
     ON CONFLICT(address) DO UPDATE SET kyc_level = MAX(kyc_level, 1)`
  ).run(caller);

  res.json({ address: caller, kycLevel: 1, status: "pending" });
});

// POST /admin/kyc/:address/approve -- setKyc(address, true) from ORG wallet, then gasDrip
// Operator action (it sends a transaction and drips gas from the ORG wallet): admin token, not the public API key.
kycRouter.post("/admin/kyc/:address/approve", requireAdminToken, async (req, res) => {
  if (!ESCROW || !org) {
    return res.status(500).json({ error: { code: "CHAIN_UNCONFIGURED", message: "chain not configured yet" } });
  }
  try {
    const address = getAddress(String(req.params.address));
    const { hash } = await sendContractTx(org, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "setKyc",
      args: [address, true],
    });

    db.prepare(
      `INSERT INTO users (address, kyc_level) VALUES (?, 2)
       ON CONFLICT(address) DO UPDATE SET kyc_level = 2`
    ).run(address.toLowerCase());

    await gasDripAddress(address);

    res.json({ address, kycLevel: 2, txHash: hash });
  } catch (err: any) {
    console.error("[kyc] approval failed:", err?.shortMessage ?? err?.message ?? err);
    res.status(500).json({ error: { code: "APPROVAL_FAILED", message: "KYC approval failed" } });
  }
});
