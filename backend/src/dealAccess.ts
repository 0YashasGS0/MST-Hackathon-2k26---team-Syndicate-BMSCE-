// B1: route guards for deal-scoped actions and the arbitrator console. The caller (PG's session) must be the deal's buyer and/or seller as
// recorded ON-CHAIN (getDeal is the source of truth). Runs before any upload or wallet transaction.
import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { escrowAbi, ESCROW, pub } from "./chain.js";
import { getCaller } from "./auth.js";
import { accounts } from "./accountsStore.js";
import { ChainUnavailableError, readOnchainDeal } from "./dealView.js";

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

const isAdmin = (req: Request) => {
  const expected = process.env.ADMIN_TOKEN;
  const got = req.header("x-admin-token");
  if (!expected || !got) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(got), h(expected));
};

/**
 * Arbitrator console: a signed-in wallet listed in ARBITRATOR_ADDRESSES (the app's arbitrator role), or the operator's
 * X-Admin-Token (scripts/ops). The admin token never has to live in a browser.
 */
export function requireArbitrator(req: Request, res: Response, next: NextFunction): void {
  const caller = getCaller(req)?.toLowerCase();
  if (isAdmin(req) || (caller && accounts.isArbitrator(caller))) {
    res.locals.caller = caller;
    return next();
  }
  res.status(caller ? 403 : 401).json({ error: { code: caller ? "Forbidden" : "Unauthorized", message: "arbitrators only" } });
}

/** Reading a deal's details: its parties (on-chain) or an arbitrator. Sets res.locals.deal (the on-chain struct). */
export function requireDealAccess(): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const idParam = String(req.params.id);
    if (!DEAL_ID.test(idParam)) return void res.status(400).json({ error: { code: "BadRequest", message: "deal id must be a non-negative integer" } });
    const caller = getCaller(req)?.toLowerCase();
    const arbitrator = isAdmin(req) || (!!caller && accounts.isArbitrator(caller));
    if (!caller && !arbitrator) return void res.status(401).json({ error: { code: "Unauthorized", message: "sign in first" } });
    let deal;
    try {
      deal = await readOnchainDeal(Number(idParam));
    } catch (err) {
      const unconfigured = err instanceof ChainUnavailableError && /not configured/.test(err.message);
      return void res.status(unconfigured ? 500 : 502).json({ error: { code: unconfigured ? "ChainUnconfigured" : "ChainUnavailable", message: "could not read the deal from MST" } });
    }
    if (!deal) return void res.status(404).json({ error: { code: "NotFound", message: "deal not found on-chain" } });
    const role = caller === deal.buyer.toLowerCase() ? "buyer" : caller === deal.seller.toLowerCase() ? "seller" : null;
    if (!role && !arbitrator) return void res.status(403).json({ error: { code: "Forbidden", message: "only the deal's parties or an arbitrator can see this" } });
    res.locals.caller = caller;
    res.locals.dealRole = role;
    res.locals.deal = deal;
    next();
  };
}
