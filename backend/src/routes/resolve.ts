// Hour 5-8 — Dispute & arbitration plumbing, per TEAM_ROADMAP.md §1.
// The SOW, the scoring and the ruling storage are B2's (merge plan): store.getSowForDeal, scoreDispute, store.saveRuling.
import { Router, Request, Response } from "express";
import { agent, arbitrator, org, escrowAbi, ESCROW, pub, sendContractTx } from "../chain.js";
import { DemoFallbackError, DisputeScoringError, LlmUnavailableError, scoreDispute } from "../agent/index.js";
import { sowStore as store } from "../sowStore.js";
import { db } from "../db.js";
import { requireApiKey } from "../auth.js";
import { requireArbitrator, requireDealParty } from "../dealAccess.js";
import { readOnchainDeal, toDealView } from "../dealView.js";
import { sendChainError } from "../errors.js";

const DEAL_ID = /^\d+$/;

async function readDealHashes(dealId: number) {
  const d = (await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getDeal", args: [BigInt(dealId)] })) as {
    sowHash: `0x${string}`;
    deliveryHash: `0x${string}`;
    evidenceHash: `0x${string}`;
  };
  return { sowHash: d.sowHash, deliveryHash: d.deliveryHash, evidenceHash: d.evidenceHash };
}

/** Files are hashed on upload; the agent sees their names + hashes plus the parties' notes. */
function filesSummary(dealId: number, kind: "delivery" | "evidence"): string {
  const rows = db.prepare("SELECT path, keccak FROM files WHERE deal_id = ? AND kind = ?").all(dealId, kind) as { path: string; keccak: string }[];
  return rows.map((r) => `file ${r.path.split(/[\\/]/).pop()} (keccak256 ${r.keccak})`).join("\n");
}

export const resolveRouter = Router();

// Arbitrator routes use requireArbitrator (dealAccess.ts): a signed-in wallet in ARBITRATOR_ADDRESSES, or the operator's
// X-Admin-Token. The public frontend API key alone can't rule on disputes.

// POST /deals/:id/resolve — load SOW + delivery/evidence, call scoreDispute(),
// have the agent wallet call proposeResolution, store the full reasoning.
// A party of the deal (checked on-chain) asks the agent to score the dispute; rate-limited in app.ts.
resolveRouter.post("/deals/:id/resolve", requireApiKey, requireDealParty(["buyer", "seller"]), async (req: Request, res: Response) => {
  if (!ESCROW || !agent) return void res.status(500).json({ error: { code: "ChainUnconfigured", message: "chain not configured yet" } });
  if (!DEAL_ID.test(String(req.params.id))) return void res.status(400).json({ error: { code: "BadRequest", message: "deal id must be a non-negative integer" } });
  const dealId = Number(req.params.id);
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 5000) : "");

  const linked = store.getSowForDeal(dealId);
  if (!linked) return void res.status(409).json({ error: { code: "NoSow", message: "no agreed SOW is linked to this deal" } });

  let ruling;
  try {
    const onchain = await readDealHashes(dealId);
    ruling = await scoreDispute(
      {
        dealId,
        sow: linked.sow,
        sowHash: onchain.sowHash,
        deliveryHash: onchain.deliveryHash,
        evidenceHash: onchain.evidenceHash,
        complaint: text(req.body?.complaintText ?? req.body?.complaint),
        deliveryNotes: [text(req.body?.deliveryNotes), filesSummary(dealId, "delivery")].filter(Boolean).join("\n"),
        evidenceNotes: [text(req.body?.evidenceNotes), filesSummary(dealId, "evidence")].filter(Boolean).join("\n"),
      },
      { store },
    );
  } catch (err: any) {
    if (err instanceof DisputeScoringError) return void res.status(422).json({ error: { code: "ScoringFailed", message: err.message, details: err.issues } });
    if (err instanceof DemoFallbackError) return void res.status(422).json({ error: { code: "DemoFallback", message: err.message } });
    if (err instanceof LlmUnavailableError) return void res.status(502).json({ error: { code: "LlmUnavailable", message: err.message } });
    return void sendChainError(res, err);
  }

  try {
    const { hash } = await sendContractTx(agent, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "proposeResolution",
      args: [BigInt(dealId), ruling.buyerBps, ruling.reasoningHash],
    });
    res.json({ scores: ruling.scores, buyerBps: ruling.buyerBps, reasoningHash: ruling.reasoningHash, txHash: hash });
  } catch (err: any) {
    sendChainError(res, err);
  }
});

// POST /arbitrator/deals/:id/rule — human arbitrator's final call, admin-token protected.
// The ruling is stored first (reasoningHash = hashJson(ruling)) so it is verifiable via /deals/:id/verify.
resolveRouter.post("/arbitrator/deals/:id/rule", requireArbitrator, async (req: Request, res: Response) => {
  if (!ESCROW || !arbitrator) return void res.status(500).json({ error: { code: "ChainUnconfigured", message: "chain not configured yet" } });
  if (!DEAL_ID.test(String(req.params.id))) return void res.status(400).json({ error: { code: "BadRequest", message: "deal id must be a non-negative integer" } });
  const dealId = Number(req.params.id);
  const { buyerBps, ruling, note } = req.body ?? {};
  const bps = Number(buyerBps);
  const rulingText = typeof ruling === "string" && ruling.trim() ? ruling.trim() : typeof note === "string" ? note.trim() : "";
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000 || !rulingText) {
    return void res.status(400).json({ error: { code: "BadRequest", message: "buyerBps (integer 0-10000) and ruling are required" } });
  }

  try {
    const sowHash = store.getSowForDeal(dealId)?.sowHash ?? (await readDealHashes(dealId)).sowHash;
    const reasoningHash = store.saveRuling({ source: "arbitrator", dealId, sowHash: sowHash.toLowerCase(), buyerBps: bps, ruling: rulingText.slice(0, 5000) });
    const { hash } = await sendContractTx(arbitrator, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "arbitrate",
      args: [BigInt(dealId), bps, reasoningHash],
    });
    const deal = await readOnchainDeal(dealId).catch(() => null);
    res.json({ ...(deal ? toDealView(dealId, deal) : {}), reasoningHash, txHash: hash }); // frontend expects the updated Deal
  } catch (err: any) {
    sendChainError(res, err);
  }
});

// POST /deals/:id/timeout — calls claimTimeout(id). Anyone can call this on-chain;
// we call it from the ORG wallet so the frontend doesn't need to pay gas for it.
resolveRouter.post("/deals/:id/timeout", requireApiKey, requireDealParty(["buyer", "seller"]), async (req: Request, res: Response) => {
  if (!ESCROW || !org) return void res.status(500).json({ error: { code: "ChainUnconfigured", message: "chain not configured yet" } });
  if (!DEAL_ID.test(String(req.params.id))) return void res.status(400).json({ error: { code: "BadRequest", message: "deal id must be a non-negative integer" } });
  const dealId = Number(req.params.id);

  try {
    const { hash } = await sendContractTx(org, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "claimTimeout",
      args: [BigInt(dealId)],
    });
    res.json({ txHash: hash });
  } catch (err: any) {
    sendChainError(res, err);
  }
});
