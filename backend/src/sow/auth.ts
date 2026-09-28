// The ONLY source of caller identity for the SOW router.
// TODO(PG): swap for real signed login (SARAL / wallet signature) at merge time; keep the signature.
import type { Request } from "express";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Lowercased caller address, or null if the request carries no valid identity. */
export function getCaller(req: Request): string | null {
  const h = req.header("x-user-address");
  return h && ADDRESS.test(h) ? h.toLowerCase() : null;
}
