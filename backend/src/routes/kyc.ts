import { Router } from "express";
import path from "path";
import fs from "fs";
import { getAddress, keccak256 } from "viem";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { db } from "../db.js";
import { org, escrowAbi, ESCROW, sendContractTx } from "../chain.js";
import { getCaller, requireApiKey } from "../auth.js";
import { requireAdminToken, safeUpload } from "../security.js";
import { AccountError } from "../accounts.js";
import { accounts } from "../accountsStore.js";

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
const upload = safeUpload(UPLOAD_DIR, { fileSize: 10 * 1024 * 1024, files: 1 }); // one ID document ≤ 10 MB, random name

// POST /kyc/submit -- mock KYC for the SIGNED-IN wallet: saves the document and the profile (name + mobile, used to
// find people), kyc_level = max(current, 1), returns the account (frontend `User`). The PAN is never stored.
// A different `address` field is rejected, so nobody can submit for someone else.
kycRouter.post("/kyc/submit", requireApiKey, requireSignedIn, upload.single("file"), (req, res) => {
  const caller = res.locals.caller as string;
  const drop = () => req.file && fs.rmSync(req.file.path, { force: true });
  const claimed = typeof req.body?.address === "string" ? req.body.address.toLowerCase() : caller;
  if (claimed !== caller) {
    drop();
    return void res.status(403).json({ error: { code: "Forbidden", message: "you can only submit KYC for your own wallet" } });
  }
  if (!req.file) return void res.status(400).json({ error: { code: "BadRequest", message: "file is required" } });
  try {
    const user = accounts.saveKycProfile(caller, req.body?.name, req.body?.phone);
    db.prepare(`INSERT INTO files (deal_id, kind, path, keccak, name, mime, size) VALUES (NULL, 'kyc', ?, ?, ?, ?, ?)`).run(
      req.file.path,
      keccak256(fs.readFileSync(req.file.path)),
      req.file.originalname.slice(0, 200),
      req.file.mimetype,
      req.file.size,
    );
    res.json(user);
  } catch (err) {
    drop();
    if (err instanceof AccountError) return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
    throw err;
  }
});

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
