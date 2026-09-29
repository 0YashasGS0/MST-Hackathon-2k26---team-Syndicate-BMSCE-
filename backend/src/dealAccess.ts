// B1: route guard for deal-scoped actions. The caller (PG's session) must be the deal's buyer and/or seller as
// recorded ON-CHAIN (getDeal is the source of truth). Runs before any upload or wallet transaction.
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { escrowAbi, ESCROW, pub } from "./chain.js";
import { getCaller } from "./auth.js";

export type DealRole = "buyer" | "seller";
const DEAL_ID = /^\d{1,18}$/;

export function requireDealParty(roles: DealRole[]): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const caller = getCaller(req)?.toLowerCase();
    if (!caller) return void res.status(401).json({ error: { code: "Unauthorized", message: "sign in first" } });
    const idParam = String(req.params.id);
    if (!DEAL_ID.test(idParam)) return void res.status(400).json({ error: { code: "BadRequest", message: "deal id must be a non-negative integer" } });
    if (!ESCROW) return void res.status(500).json({ error: { code: "ChainUnconfigured", message: "chain not configured yet" } });
    let deal: { buyer: string; seller: string; status: number };
    try {
      deal = (await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getDeal", args: [BigInt(idParam)] })) as typeof deal;
    } catch {
      return void res.status(502).json({ error: { code: "ChainUnavailable", message: "could not read the deal from MST" } });
    }
    if (Number(deal.status) === 0) return void res.status(404).json({ error: { code: "NotFound", message: "deal not found on-chain" } });
    const role: DealRole | null = caller === deal.buyer.toLowerCase() ? "buyer" : caller === deal.seller.toLowerCase() ? "seller" : null;
    if (!role || !roles.includes(role)) {
      return void res.status(403).json({ error: { code: "Forbidden", message: `only the deal's ${roles.join(" or ")} can do this` } });
    }
    res.locals.caller = caller;
    res.locals.dealRole = role;
    next();
  };
}
