// SOW hash = keccak256(utf8(RFC 8785 canonical JSON)).
// Buyer (proposeDeal) and seller (acceptDeal) must commit this exact bytes32.
import canonicalize from "canonicalize";
import { keccak256, toBytes, type Hex } from "viem";
import { parseSow, type Sow } from "./sow.js";

/** Generic RFC 8785 canonical JSON → keccak256 (e.g. reasoningHash). No schema, no normalization. */
export function hashJson(obj: unknown): Hex {
  return keccak256(toBytes(canonicalJson(obj)));
}

/** Canonical JSON string (RFC 8785 / JCS) of a validated SOW. Addresses are lowercased first. */
export function canonicalSow(input: unknown): string {
  return canonicalJson(normalize(parseSow(input)));
}

function canonicalJson(obj: unknown): string {
  const json = canonicalize(obj);
  if (json === undefined) throw new Error("value is not canonicalizable");
  return json;
}

/** bytes32 hash committed on-chain. */
export function hashSow(input: unknown): Hex {
  return keccak256(toBytes(canonicalSow(input)));
}

// Checksummed vs lowercase addresses must not change the hash.
function normalize(sow: Sow): Sow {
  return {
    ...sow,
    buyer: sow.buyer.toLowerCase(),
    seller: sow.seller.toLowerCase(),
    token: sow.token.toLowerCase(),
  };
}
