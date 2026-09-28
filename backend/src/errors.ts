// Maps every DealEscrow revert (BadStatus, NotParty, TooEarly, ...) to a
// readable HTTP error, per TEAM_ROADMAP.md §1 "Hour 5-8 step 4":
// "Map every contract revert ... to readable HTTP errors using viem's decodeErrorResult."
import { decodeErrorResult, BaseError, ContractFunctionRevertedError } from "viem";
import { Response } from "express";
import { escrowAbi } from "./chain";

const STATUS_NAMES = [
  "None", "Proposed", "Accepted", "Funded", "Delivered", "Disputed",
  "ResolutionProposed", "Escalated", "Released", "Refunded", "Resolved", "Cancelled",
];

/** Pulls the friendliest message out of a viem contract-call error. */
export function describeChainError(err: any): { code: string; message: string } {
  // viem wraps reverts in BaseError -> walk the chain looking for the revert data.
  if (err instanceof BaseError) {
    const revertError = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revertError instanceof ContractFunctionRevertedError) {
      const errorName = revertError.data?.errorName ?? "UnknownError";
      const args = revertError.data?.args ?? [];

      switch (errorName) {
        case "BadStatus": {
          const current = typeof args[0] === "number" ? STATUS_NAMES[args[0]] ?? args[0] : args[0];
          return { code: errorName, message: `Deal is not in the right state for this action (current: ${current}).` };
        }
        case "NotParty":
          return { code: errorName, message: "Only the buyer or seller of this deal can do that." };
        case "NotBuyer":
          return { code: errorName, message: "Only the buyer can do that." };
        case "NotSeller":
          return { code: errorName, message: "Only the seller can do that." };
        case "NotAgent":
          return { code: errorName, message: "Only the AI agent wallet can propose a resolution." };
        case "NotArbitrator":
          return { code: errorName, message: "Only the arbitrator can rule on this deal." };
        case "KycRequired":
          return { code: errorName, message: `KYC is required for ${args[0] ?? "this address"} before this action.` };
        case "InvalidParams":
          return { code: errorName, message: "One or more parameters were invalid (e.g. SOW hash mismatch, bad amount)." };
        case "TooEarly":
          return { code: errorName, message: "The review window or deadline hasn't passed yet." };
        default:
          return { code: errorName, message: `Contract reverted: ${errorName}` };
      }
    }
  }

  // Fallback: try to decode raw revert data directly (e.g. from a raw call, not a writeContract).
  try {
    if (err?.data) {
      const decoded = decodeErrorResult({ abi: escrowAbi, data: err.data });
      return { code: decoded.errorName, message: `Contract reverted: ${decoded.errorName}` };
    }
  } catch {
    // not decodable, fall through
  }

  return { code: "UnknownError", message: err?.shortMessage ?? err?.message ?? "Unknown chain error" };
}

/** Sends a consistent { error, code, message } JSON body for a failed chain call. */
export function sendChainError(res: Response, err: any, httpStatus = 400) {
  const { code, message } = describeChainError(err);
  res.status(httpStatus).json({ error: "chain_revert", code, message });
}
