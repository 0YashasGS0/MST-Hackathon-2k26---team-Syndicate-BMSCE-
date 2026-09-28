import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { keccak256 } from "viem";
import { db } from "../db";
import { pub, escrowAbi, ESCROW } from "../chain";
import { requireApiKey } from "../auth";

export const dealsRouter = Router();

const UPLOAD_DIR = path.join(__dirname, "..", "..", "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

function serializeDeal(deal: any) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(deal)) {
    out[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return out;
}

// GET /deals/:id -- merge on-chain getDeal (source of truth) with local chain_events
dealsRouter.get("/deals/:id", requireApiKey, async (req, res) => {
  if (!ESCROW) return res.status(500).json({ error: "chain not configured yet" });
  const id = Number(req.params.id);

  try {
    const deal = await pub.readContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: "getDeal",
      args: [BigInt(id)],
    });

    const events = db
      .prepare("SELECT tx_hash, name, args_json, block FROM chain_events WHERE deal_id = ? ORDER BY block ASC")
      .all(id) as any[];

    res.json({
      id,
      ...serializeDeal(deal),
      events: events.map((e) => ({ tx_hash: e.tx_hash, name: e.name, args: JSON.parse(e.args_json), block: e.block })),
    });
  } catch (err: any) {
    res.status(404).json({ error: "deal not found or chain call failed", detail: err.shortMessage ?? err.message });
  }
});

// POST /deals/:id/delivery -- save file, return keccak256 hash for seller to sign markDelivered(id, hash)
dealsRouter.post("/deals/:id/delivery", requireApiKey, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const dealId = Number(req.params.id);
  const bytes = fs.readFileSync(req.file.path);
  const hash = keccak256(bytes);

  db.prepare(`INSERT INTO files (deal_id, kind, path, keccak) VALUES (?, 'delivery', ?, ?)`).run(
    dealId,
    req.file.path,
    hash
  );

  res.json({ hash });
});

// POST /deals/:id/evidence -- same idea, for dispute evidence -> raiseDispute(id, hash)
dealsRouter.post("/deals/:id/evidence", requireApiKey, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const dealId = Number(req.params.id);
  const bytes = fs.readFileSync(req.file.path);
  const hash = keccak256(bytes);

  db.prepare(`INSERT INTO files (deal_id, kind, path, keccak) VALUES (?, 'evidence', ?, ?)`).run(
    dealId,
    req.file.path,
    hash
  );

  res.json({ hash });
});
