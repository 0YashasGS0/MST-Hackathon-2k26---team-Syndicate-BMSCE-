import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { getAddress } from "viem";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { db } from "../db.js";
import { org, escrowAbi, ESCROW, sendContractTx } from "../chain.js";
import { requireApiKey, gasDripAddress } from "../auth.js";

export const kycRouter = Router();

const UPLOAD_DIR = path.join(__dirname, "..", "..", "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

// POST /kyc/submit -- save the mock KYC doc, kyc_level = max(current, 1)
kycRouter.post("/kyc/submit", requireApiKey, upload.single("file"), (req, res) => {
  const address = req.body.address as string | undefined;
  if (!address || !req.file) {
    return res.status(400).json({ error: "address and file are required" });
  }
  db.prepare(
    `INSERT INTO users (address, kyc_level) VALUES (?, 1)
     ON CONFLICT(address) DO UPDATE SET kyc_level = MAX(kyc_level, 1)`
  ).run(address.toLowerCase());

  res.json({ address, kycLevel: 1, status: "pending" });
});

// POST /admin/kyc/:address/approve -- setKyc(address, true) from ORG wallet, then gasDrip
kycRouter.post("/admin/kyc/:address/approve", requireApiKey, async (req, res) => {
  if (!ESCROW || !org) {
    return res.status(500).json({ error: { code: "CHAIN_UNCONFIGURED", message: "chain not configured yet" } });
  }
  try {
    const address = getAddress(req.params.address);
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
    res.status(500).json({ error: { code: "APPROVAL_FAILED", message: err.message } });
  }
});
