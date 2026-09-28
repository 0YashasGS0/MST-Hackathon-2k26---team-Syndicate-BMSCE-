// PG's routes (Person 3 — Payment Gateway), per TEAM_ROADMAP.md §3.
// Stubbed to the exact endpoint shapes the roadmap specifies, wired into the
// SAME db/chain/auth B1 already set up, so PG doesn't fork state or re-invent
// the API-key middleware. PG: fill in the TODOs; don't change the signatures
// without updating docs/API.md in the same commit (see AGENTS.md rule 3).
import { Router, Request, Response } from "express";
import { db } from "../db";
import { org, usdAbi, escrowAbi, USD, ESCROW, pub, sendContractTx } from "../chain";
import { requireApiKey } from "../auth";
import { sendChainError } from "../errors";
import { parseUnits, formatUnits } from "viem";

export const paymentsRouter = Router();

const DEMO_INR_PER_MUSD = 84; // fixed demo rate, per §3 "Hour 2-4 step 2"

// POST /onramp/:dealId/session — creates a payment row, returns a fake UPI payload.
paymentsRouter.post("/onramp/:dealId/session", requireApiKey, (req: Request, res: Response) => {
  const dealId = Number(req.params.dealId);
  const amountMusd = req.body?.amount; // string, e.g. "100.00"
  if (!amountMusd) return res.status(400).json({ error: "amount is required" });

  const amountInr = (Number(amountMusd) * DEMO_INR_PER_MUSD).toFixed(2);

  db.prepare(
    `INSERT INTO payments (deal_id, amount, status) VALUES (?, ?, 'created')
     ON CONFLICT(deal_id) DO UPDATE SET amount = excluded.amount, status = 'created'`
  ).run(dealId, amountMusd);

  res.json({
    dealId,
    amountInr,
    amountMusd,
    upi: { payee: "tranquebar-demo@upi", note: `deal-${dealId}` }, // mock QR payload
  });
});

// POST /onramp/:dealId/confirm — the "I've paid" button. Idempotent: created -> paid -> minted -> funded.
paymentsRouter.post("/onramp/:dealId/confirm", requireApiKey, async (req: Request, res: Response) => {
  if (!ESCROW || !USD || !org) return res.status(500).json({ error: "chain not configured yet" });
  const dealId = Number(req.params.dealId);

  const payment = db.prepare("SELECT * FROM payments WHERE deal_id = ?").get(dealId) as any;
  if (!payment) return res.status(404).json({ error: "no payment session for this deal" });

  // Idempotency: already past 'created' -> return what we have, never mint twice.
  if (payment.status !== "created") {
    return res.json({ dealId, status: payment.status, mintTx: payment.mint_tx, fundTx: payment.fund_tx });
  }

  try {
    // Check the on-chain deal is Accepted (status enum index 2) before minting.
    const deal = (await pub.readContract({
      address: ESCROW,
      abi: escrowAbi,
      functionName: "getDeal",
      args: [BigInt(dealId)],
    })) as any;
    if (Number(deal[13]) !== 2) {
      return res.status(409).json({ error: "deal is not Accepted on-chain yet" });
    }

    db.prepare("UPDATE payments SET status = 'paid' WHERE deal_id = ?").run(dealId);

    const amount = parseUnits(String(payment.amount), 6); // MockUSD = 6 decimals
    const { hash: mintTx } = await sendContractTx(org, {
      address: USD,
      abi: usdAbi,
      functionName: "mint",
      args: [org.account!.address, amount],
    });
    db.prepare("UPDATE payments SET status = 'minted', mint_tx = ? WHERE deal_id = ?").run(mintTx, dealId);

    // TODO(PG): confirm the ORG wallet has approved the escrow for `amount` (Deploy.s.sol should
    // already do approve(escrow, max) at deploy time per §3 "Hour 0-2 step 2").
    const { hash: fundTx } = await sendContractTx(org, {
      address: ESCROW,
      abi: escrowAbi,
      functionName: "fundFor",
      args: [BigInt(dealId)],
    });
    db.prepare("UPDATE payments SET status = 'funded', fund_tx = ? WHERE deal_id = ?").run(fundTx, dealId);

    res.json({ dealId, status: "funded", mintTx, fundTx });
  } catch (err: any) {
    db.prepare("UPDATE payments SET status = 'failed' WHERE deal_id = ?").run(dealId);
    sendChainError(res, err);
  }
});

// GET /deals/:id/payment — payment + payout records with human-readable amounts.
paymentsRouter.get("/deals/:id/payment", requireApiKey, (req: Request, res: Response) => {
  const dealId = Number(req.params.id);
  const payment = db.prepare("SELECT * FROM payments WHERE deal_id = ?").get(dealId) as any;
  const payout = db.prepare("SELECT * FROM payouts WHERE deal_id = ?").get(dealId) as any;

  res.json({
    payment: payment
      ? { ...payment, amountFormatted: formatUnits(parseUnits(String(payment.amount), 6), 6) }
      : null,
    payout: payout ?? null,
  });
});

// TODO(PG): POST /auth/saral (login), gasDrip(address) helper -- see TEAM_ROADMAP.md §3
// "Hour 6-9". Add them as new routes in this file, protected the same way with requireApiKey.
