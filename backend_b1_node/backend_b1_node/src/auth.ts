// API-key gate between this backend and the frontend (the "API key thing").
// The frontend must send: X-API-Key: <BACKEND_API_KEY from .env> on every request.
// This is separate from wallet signing -- users sign their own on-chain actions
// (proposeDeal, acceptDeal, markDelivered, release, raiseDispute, ...) in their
// own wallet on the frontend, per TEAM_ROADMAP.md §4. This backend only signs
// with the 3 system wallets (ORG, agent, arbitrator) for admin-style calls.
import { Request, Response, NextFunction } from "express";

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.header("X-API-Key");
  if (!key || key !== process.env.BACKEND_API_KEY) {
    return res.status(401).json({ error: "unauthorized", message: "missing or invalid X-API-Key header" });
  }
  next();
}
