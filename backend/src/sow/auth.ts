// Caller identity for B2's routers. Both routers take an injectable GetCaller and use ONLY that for identity.
// MERGE: B1 passes PG's getCaller from ../auth (session cookie; x-user-address only when AUTH_DEV_HEADER=true).
import type { Request } from "express";

/** Caller's address, or null when the request carries no valid identity. The routers lowercase it. */
export type GetCaller = (req: Request) => string | null;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Default GetCaller, mirroring PG's semantics without sessions: the x-user-address header is trusted ONLY when
 * env AUTH_DEV_HEADER=true (dev/tests); otherwise every request is unauthenticated (null → 401).
 */
export const getCaller: GetCaller = (req) => {
  if (process.env.AUTH_DEV_HEADER !== "true") return null;
  const h = req.header("x-user-address");
  return h && ADDRESS.test(h) ? h.toLowerCase() : null;
};
