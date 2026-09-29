// Hour 5-8 — Dispute & arbitration plumbing, per TEAM_ROADMAP.md §1.
import { Router, Request, Response, NextFunction } from "express";
import { keccak256, stringToHex } from "viem";
import { agent, arbitrator, org, escrowAbi, ESCROW, sendContractTx } from "../chain";
import { scoreDispute } from "../agent/scoreDispute.js";
import { hashJson } from "../sow/hash.js";
import { SowStore } from "../sow/store.js";
import { db } from "../db.js";
import { requireApiKey } from "../auth.js";
import { sendChainError } from "../errors.js";

const store = new SowStore(db);

export const resolveRouter = Router();

// A separate, simpler token for the arbitrator console (per doc: "protect it
// with a simple admin token"), so a normal frontend API key can't rule on disputes.
function requireAdminToken(req: Request, res: Response, next: NextFunction) {
  const token = req.header("X-Admin-Token");
  if (!token || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).json({ error: "unauthorized", message: "missing or invalid X-Admin-Token header" });
  }
  next();
}

// POST /deals/:id/resolve — load SOW + delivery/evidence, call scoreDispute(),
// have the agent wallet call proposeResolution, store the full reasoning.
resolveRouter.post("/deals/:id/resolve", requireApiKey, async (req: Request, res: Response) => {
  if (!ESCROW || !agent) return res.status(500).json({ error: "chain not configured yet" });
  const dealId = Number(req.params.id);
  const complaintText: string = req.body?.complaintText ?? "";

  try {
    const deal = db.prepare("SELECT draft_id, sow_version FROM deals WHERE id = ?").get(dealId) as any;
    const sowRow = deal?.draft_id
      ? (db
          .prepare("SELECT sow_json FROM sow_versions WHERE draft_id = ? AND version = ?")
          .get(deal.draft_id, deal.sow_version) as any)
      : null;
    const sow = sowRow ? JSON.parse(sowRow.sow_json) : null;

    const deliveryFiles = db
      .prepare("SELECT path, keccak FROM files WHERE deal_id = ? AND kind = 'delivery'")
      .all(dealId) as any[];
    const evidenceFiles = db
      .prepare("SELECT path, keccak FROM files WHERE deal_id = ? AND kind = 'evidence'")
      .all(dealId) as any[];

    const result = await scoreDispute({ dealId, sow, sowHash: sowRow?.sow_hash, deliveryHash: "0x0", evidenceHash: "0x0", complaint: complaintText, files: [...deliveryFiles, ...evidenceFiles] });

    const { hash } = await sendContractTx(agent, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "proposeResolution",
      args: [BigInt(dealId), result.buyerBps, result.reasoningHash],
    });

    res.json({ scores: result.scores, buyerBps: result.buyerBps, reasoningHash: result.reasoningHash, tx_hash: hash });
  } catch (err: any) {
    sendChainError(res, err);
  }
});

// POST /arbitrator/deals/:id/rule — human arbitrator's final call, admin-token protected.
resolveRouter.post("/arbitrator/deals/:id/rule", requireAdminToken, async (req: Request, res: Response) => {
  if (!ESCROW || !arbitrator) return res.status(500).json({ error: "chain not configured yet" });
  const dealId = Number(req.params.id);
  const { buyerBps, ruling, note } = req.body ?? {};
  if (buyerBps === undefined || !ruling) {
    return res.status(400).json({ error: "buyerBps and ruling are required" });
  }

  try {
    const payload = { source: "arbitrator", dealId, sowHash: "0x0", buyerBps: Number(buyerBps), ruling, note };
    const reasoningHash = hashJson(payload);

    const { hash } = await sendContractTx(arbitrator, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "arbitrate",
      args: [BigInt(dealId), Number(buyerBps), reasoningHash as `0x${string}`],
    });

    store.saveRuling(reasoningHash, dealId, "arbitrator", buyerBps, payload, hash);

    res.json({ reasoningHash, tx_hash: hash });
  } catch (err: any) {
    sendChainError(res, err);
  }
});

// POST /deals/:id/timeout — calls claimTimeout(id). Anyone can call this on-chain;
// we call it from the ORG wallet so the frontend doesn't need to pay gas for it.
resolveRouter.post("/deals/:id/timeout", requireApiKey, async (req: Request, res: Response) => {
  if (!ESCROW || !org) return res.status(500).json({ error: "chain not configured yet" });
  const dealId = Number(req.params.id);

  try {
    const { hash } = await sendContractTx(org, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "claimTimeout",
      args: [BigInt(dealId)],
    });
    res.json({ tx_hash: hash });
  } catch (err: any) {
    sendChainError(res, err);
  }
});
