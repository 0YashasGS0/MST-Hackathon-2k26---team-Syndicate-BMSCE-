import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { keccak256 } from "viem";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { db } from "../db.js";
import { pub, escrowAbi, ESCROW } from "../chain.js";
import { requireApiKey, getCaller } from "../auth.js";

export const dealsRouter = Router();

const DEAL_STATUS = ["Created", "Funded", "Delivered", "Disputed", "Resolved"];

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

// GET /deals?address=0x...
dealsRouter.get("/deals", requireApiKey, async (req, res) => {
  const address = req.query.address as string;
  if (!address) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "address query required" } });
  
  const deals = db.prepare("SELECT * FROM deals WHERE buyer = ? OR seller = ? ORDER BY id DESC").all(address, address);
  res.json({ deals: deals.map((d: any) => ({ ...d, status: d.status })) });
});

// GET /deals/:id -- merge on-chain getDeal (source of truth) with local chain_events
dealsRouter.get("/deals/:id", requireApiKey, async (req, res) => {
  if (!ESCROW) return res.status(500).json({ error: { code: "CHAIN_UNCONFIGURED", message: "chain not configured yet" } });
  const id = Number(req.params.id);

  try {
    const deal = await pub.readContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: "getDeal",
      args: [BigInt(id)],
    });

    const events = db
      .prepare("SELECT tx_hash, name, args_json, block, log_index FROM chain_events WHERE deal_id = ? ORDER BY block ASC")
      .all(id) as any[];
      
    const localDeal = db.prepare("SELECT draft_id FROM deals WHERE id = ?").get(id) as any;
    let draftId = localDeal?.draft_id;
    let title = "Deal";
    if (draftId) {
       // Just mock title for now since drafts table is gone, B2 handles it in their routes
       title = "Deal " + id;
    }

    res.json({
      id,
      draftId,
      title,
      ...serializeDeal(deal),
      status: DEAL_STATUS[Number((deal as any).status)] || "Unknown",
      events: events.map((e) => ({ 
        txHash: e.tx_hash, 
        name: e.name, 
        args: JSON.parse(e.args_json), 
        block: e.block,
        logIndex: e.log_index,
        timestamp: 0 
      })),
    });
  } catch (err: any) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "deal not found or chain call failed" } });
  }
});

// POST /deals/:id/delivery -- save file, return keccak256 hash for seller to sign markDelivered(id, hash)
dealsRouter.post("/deals/:id/delivery", requireApiKey, upload.array("files"), (req, res) => {
  const caller = getCaller(req);
  const dealId = Number(req.params.id);
  const files = (req.files as Express.Multer.File[]) || [];
  const note = req.body.note || "";
  
  if (files.length === 0 && !note) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "files or note required" } });
  
  let hash = "0x0";
  for (const file of files) {
    const bytes = fs.readFileSync(file.path);
    hash = keccak256(bytes);
    db.prepare(`INSERT INTO files (deal_id, kind, path, keccak) VALUES (?, 'delivery', ?, ?)`).run(dealId, file.path, hash);
  }

  res.json({ hash });
});

// POST /deals/:id/evidence -- same idea, for dispute evidence -> raiseDispute(id, hash)
dealsRouter.post("/deals/:id/evidence", requireApiKey, upload.array("files"), (req, res) => {
  const caller = getCaller(req);
  const dealId = Number(req.params.id);
  const files = (req.files as Express.Multer.File[]) || [];
  const complaint = req.body.complaint || req.body.note || "";
  
  if (files.length === 0 && !complaint) return res.status(400).json({ error: { code: "BAD_REQUEST", message: "files or complaint required" } });

  let hash = "0x0";
  for (const file of files) {
    const bytes = fs.readFileSync(file.path);
    hash = keccak256(bytes);
    db.prepare(`INSERT INTO files (deal_id, kind, path, keccak) VALUES (?, 'evidence', ?, ?)`).run(dealId, file.path, hash);
  }

  res.json({ hash });
});

// GET /arbitrator/cases
dealsRouter.get("/arbitrator/cases", requireApiKey, (req, res) => {
  // Return deals that are Escalated (or Disputed for demo)
  const deals = db.prepare("SELECT * FROM deals WHERE status = 'Disputed' OR status = 'Escalated' ORDER BY id DESC").all();
  res.json({ deals: deals.map((d: any) => ({ ...d, status: d.status })) });
});
