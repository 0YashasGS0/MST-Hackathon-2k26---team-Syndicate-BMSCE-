import { type Hex } from "viem";
/** Generic RFC 8785 canonical JSON → keccak256 (e.g. reasoningHash). No schema, no normalization. */
export declare function hashJson(obj: unknown): Hex;
/** Canonical JSON string (RFC 8785 / JCS) of a validated SOW. Addresses are lowercased first. */
export declare function canonicalSow(input: unknown): string;
/** bytes32 hash committed on-chain. */
export declare function hashSow(input: unknown): Hex;
