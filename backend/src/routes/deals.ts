// B1: deal reads (one Deal shape, see dealView.ts), delivery/evidence uploads, complaints, resolutions, arbitrator cases.
// Money moves only on-chain: the parties sign markDelivered / raiseDispute / release / acceptResolution / escalate with
// their own wallets; these routes store the files and notes and return the hash to sign.
import { Router, type Request, type Response } from "express";
import path from "path";
import fs from "fs";
import { keccak256 } from "viem";
import { fileURLToPath } from "url";
import { hashJson, type Reasoning } from "@kernel-exploits/shared";
import { db } from "../db.js";
import { getCaller, requireApiKey } from "../auth.js";
import { requireArbitrator, requireDealAccess, requireDealParty } from "../dealAccess.js";
import { ChainUnavailableError, knownDealIds, latestRuling, loadDeals, toDealView, type OnchainDeal } from "../dealView.js";
import { safeUpload } from "../security.js";
import { sowStore } from "../sowStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const dealsRouter = Router();

const UPLOAD_DIR = path.join(__dirname, "..", "..", "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = safeUpload(UPLOAD_DIR); // 5 files × 20 MB, type allowlist, random file names

const now = () => Math.floor(Date.now() / 1000);
const text = (v: unknown, max = 5000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const fail = (res: Response, status: number, code: string, message: string) => void res.status(status).json({ error: { code, message } });
const chainError = (res: Response, err: unknown) =>
  err instanceof ChainUnavailableError ? fail(res, 502, "ChainUnavailable", "could not read the deal from MST") : fail(res, 500, "Internal", "internal error");

/**
 * Saves uploaded files + a note and returns the bytes32 to sign on-chain. One file and no note → that file's keccak256
 * (as before); anything else → hashJson({ files: [keccak…], note }), so a note-only delivery still gets a real hash.
 */
function recordUpload(dealId: number, kind: "delivery" | "evidence", files: Express.Multer.File[], note: string): `0x${string}` {
  const hashes = files.map((f) => keccak256(fs.readFileSync(f.path)));
  const insert = db.prepare(`INSERT INTO files (deal_id, kind, path, keccak, name, mime, size) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  db.transaction(() => {
    files.forEach((f, i) => insert.run(dealId, kind, f.path, hashes[i], f.originalname.slice(0, 200), f.mimetype, f.size));
    if (note) {
      db.prepare(`INSERT OR REPLACE INTO deal_notes (deal_id, kind, note, created_at) VALUES (?, ?, ?, ?)`).run(dealId, kind, note, now());
    }
  })();
  return hashes.length === 1 && !note ? hashes[0] : hashJson({ files: hashes, note });
}

// GET /deals?address=0x... → Deal[] for the signed-in wallet (the address, if given, must be the caller's).
dealsRouter.get("/deals", requireApiKey, async (req: Request, res: Response) => {
  const caller = getCaller(req)?.toLowerCase();
  if (!caller) return fail(res, 401, "Unauthorized", "sign in first");
  const q = req.query.address;
  if (q !== undefined && (typeof q !== "string" || q.toLowerCase() !== caller)) return fail(res, 403, "Forbidden", "you can only list your own deals");
  try {
    res.json(await loadDeals(knownDealIds(caller)));
  } catch (err) {
    chainError(res, err);
  }
});

// GET /deals/:id → Deal (parties or an arbitrator).
dealsRouter.get("/deals/:id", requireApiKey, requireDealAccess(), (req: Request, res: Response) => {
  res.json(toDealView(Number(req.params.id), res.locals.deal as OnchainDeal));
});

// POST /deals/:id/delivery — seller only (checked on-chain) BEFORE anything is written. Returns the hash for markDelivered.
dealsRouter.post("/deals/:id/delivery", requireApiKey, requireDealParty(["seller"]), upload.array("files"), (req: Request, res: Response) => {
  const files = (req.files as Express.Multer.File[]) || [];
  const note = text(req.body?.note);
  if (files.length === 0 && !note) return fail(res, 400, "BAD_REQUEST", "files or note required");
  res.json({ hash: recordUpload(Number(req.params.id), "delivery", files, note) });
});

// POST /deals/:id/evidence — a party's complaint (text, disputed deliverables, files). Returns the hash for raiseDispute.
dealsRouter.post("/deals/:id/evidence", requireApiKey, requireDealParty(["buyer", "seller"]), upload.array("files"), (req: Request, res: Response) => {
  const dealId = Number(req.params.id);
  const files = (req.files as Express.Multer.File[]) || [];
  const complaint = text(req.body?.complaint) || text(req.body?.text) || text(req.body?.note);
  if (files.length === 0 && !complaint) return fail(res, 400, "BAD_REQUEST", "files or complaint required");
  const raw = req.body?.deliverables;
  const deliverableIds = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw])
    .map((x) => text(x, 32))
    .filter((x) => /^[A-Za-z0-9_-]{1,32}$/.test(x))
    .slice(0, 20);
  const hash = recordUpload(dealId, "evidence", files, complaint);
  db.prepare(
    `INSERT OR REPLACE INTO complaints (deal_id, raised_by, text, deliverable_ids_json, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(dealId, res.locals.dealRole, complaint, JSON.stringify(deliverableIds), now());
  res.json({ hash });
});

// GET /deals/:id/complaint → Complaint | null (parties or an arbitrator).
dealsRouter.get("/deals/:id/complaint", requireApiKey, requireDealAccess(), (req: Request, res: Response) => {
  const dealId = Number(req.params.id);
  const c = db.prepare("SELECT raised_by, text, deliverable_ids_json, created_at FROM complaints WHERE deal_id = ?").get(dealId) as
    | { raised_by: string; text: string; deliverable_ids_json: string; created_at: number }
    | undefined;
  if (!c) return void res.json(null);
  const attachments = (db.prepare("SELECT name, mime, size FROM files WHERE deal_id = ? AND kind = 'evidence' ORDER BY id").all(dealId) as {
    name: string | null;
    mime: string | null;
    size: number | null;
  }[]).map((f) => ({ name: f.name ?? "file", type: f.mime ?? "application/octet-stream", size: f.size ?? 0 }));
  res.json({
    dealId: String(dealId),
    raisedBy: c.raised_by,
    text: c.text,
    deliverableIds: JSON.parse(c.deliverable_ids_json) as string[],
    attachments,
    createdAt: c.created_at,
  });
});

// GET /deals/:id/resolution → the AI agent's proposal { scores, buyerBps } (parties or an arbitrator); 404 until it exists.
dealsRouter.get("/deals/:id/resolution", requireApiKey, requireDealAccess(), (req: Request, res: Response) => {
  const agent = sowStore.getRulingsForDeal(Number(req.params.id)).find((r) => r.reasoning.source !== "arbitrator")?.reasoning as Reasoning | undefined;
  if (!agent) return fail(res, 404, "NoResolution", "the agent hasn't proposed a resolution yet");
  const scores = agent.scores.map((s) => {
    const criteria = "criteria" in s ? s.criteria : [];
    return {
      id: s.id,
      fulfilledPct: s.fulfilledPct,
      rationale: "rationale" in s ? s.rationale : criteria.map((c) => c.rationale).join(" "),
      evidenceRefs: "evidenceRefs" in s ? s.evidenceRefs : [...new Set(criteria.flatMap((c) => c.evidenceRefs))],
    };
  });
  res.json({ scores, buyerBps: agent.buyerBps });
});

// GET /arbitrator/cases → Deal[] that are Escalated (waiting for a ruling) or already ruled by an arbitrator.
dealsRouter.get("/arbitrator/cases", requireArbitrator, async (_req: Request, res: Response) => {
  try {
    const deals = await loadDeals(knownDealIds());
    res.json(deals.filter((d) => d.status === "Escalated" || (latestRuling(Number(d.id))?.source === "arbitrator")));
  } catch (err) {
    chainError(res, err);
  }
});
