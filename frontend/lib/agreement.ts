// Tamper-evidence for agreements. The SOW is serialised with sorted keys and hashed (keccak256); each party
// signs that hash with its device key. Any later change to the SOW changes the hash and breaks the signatures.
// TODO(FE): switch to shared/src/hash.ts (RFC 8785 canonical JSON) once `shared/` is merged into this branch.
import { keccak256, toBytes, verifyMessage, type Hex } from "viem";
import type { Signature, Sow } from "./types";

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  return JSON.stringify(v);
}

export const sowHash = (sow: Sow): Hex => keccak256(toBytes(canonical(sow)));

/** True if `sig` is a valid signature over this exact SOW. */
export async function verifySignature(sow: Sow, sig: Signature): Promise<boolean> {
  try {
    return await verifyMessage({ address: sig.signer, message: { raw: sowHash(sow) }, signature: sig.signature });
  } catch {
    return false;
  }
}
