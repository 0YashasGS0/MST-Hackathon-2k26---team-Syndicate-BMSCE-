// B2: GET /deals/:id/verify — recompute an agent ruling from stored data and compare it with the chain.
// This is a convenience view: the FE verify page must run verifyRuling() itself in the browser (with split.wasm
// and reasoningHash read directly from MST), not trust this endpoint's `result`.
import express, { type NextFunction, type Request, type Response, type Router } from "express";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createPublicClient, http, parseAbi, parseAbiItem, type Hex } from "viem";
import { loadSplitWasm, parseSow, verifyRuling, type AnyReasoning, type SplitWasm } from "@kernel-exploits/shared";
import { isAddress, isHttpUrl, requireEnv } from "./env";
import { SowStore } from "./store";

/** DealEscrow.Status, in contract order. */
export const DEAL_STATUS = [
  "None", "Proposed", "Accepted", "Funded", "Delivered", "Disputed",
  "ResolutionProposed", "Escalated", "Released", "Refunded", "Resolved", "Cancelled",
] as const;

export type OnchainDeal = { reasoningHash: Hex; proposedBuyerBps: number; status: number };
/** Reads DealEscrow.getDeal(id). Injectable for tests. */
export type DealReader = (id: bigint) => Promise<OnchainDeal>;

export const GET_DEAL_ABI = parseAbi([
  "struct Deal { address buyer; address seller; uint256 amount; bytes32 sowHash; bytes32 deliveryHash; bytes32 evidenceHash; bytes32 reasoningHash; uint64 deliverBy; uint64 reviewPeriod; uint64 deliveredAt; uint16 proposedBuyerBps; bool buyerAccepted; bool sellerAccepted; uint8 status; }",
  "function getDeal(uint256 id) view returns (Deal)",
]);

/** Settled(id, toBuyer, toSeller, finalStatus) for a deal, or null if not settled. Injectable for tests. */
export type SettledReader = (id: bigint) => Promise<{ toBuyer: bigint; toSeller: bigint } | null>;

export const SETTLED_EVENT = parseAbiItem("event Settled(uint256 indexed id, uint256 toBuyer, uint256 toSeller, uint8 finalStatus)");

export function createSettledReader(rpcUrl: string, escrowAddress: string, fromBlock: bigint): SettledReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return async (id) => {
    const logs = await client.getLogs({ address: escrowAddress as Hex, event: SETTLED_EVENT, args: { id }, fromBlock, toBlock: "latest" });
    const last = logs.at(-1);
    return last ? { toBuyer: last.args.toBuyer!, toSeller: last.args.toSeller! } : null;
  };
}

export function createDealReader(rpcUrl: string, escrowAddress: string): DealReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return async (id) => {
    const d = await client.readContract({ address: escrowAddress as Hex, abi: GET_DEAL_ABI, functionName: "getDeal", args: [id] });
    return { reasoningHash: d.reasoningHash, proposedBuyerBps: d.proposedBuyerBps, status: d.status };
  };
}

export type DisputeRouterDeps = {
  store?: SowStore;
  /** Default: viem reader from env MST_RPC_URL + ESCROW_ADDRESS. */
  readDeal?: DealReader;
  /** Default: viem getLogs(Settled) from env DEPLOY_BLOCK (default 0). Only consulted when status is Resolved. */
  readSettled?: SettledReader;
  /** Default: shared/dist/split.wasm read from disk. */
  wasmBytes?: Uint8Array;
};

const ZERO_HASH = "0x" + "0".repeat(64);

function defaultWasmBytes(): Uint8Array {
  const path = createRequire(import.meta.url).resolve("@kernel-exploits/shared/dist/split.wasm");
  return readFileSync(path);
}

export function createDisputeRouter(deps: DisputeRouterDeps = {}): Router {
  const chainEnv = () => ({
    rpcUrl: requireEnv("createDisputeRouter", "MST_RPC_URL", process.env.MST_RPC_URL, isHttpUrl),
    escrow: requireEnv("createDisputeRouter", "ESCROW_ADDRESS", process.env.ESCROW_ADDRESS, isAddress),
  });
  const readDeal = deps.readDeal ?? (({ rpcUrl, escrow }) => createDealReader(rpcUrl, escrow))(chainEnv());
  // With an injected readDeal and no chain env, Settled can't be read: Resolved deals then return 502 (not a startup error).
  const haveChainEnv = !!process.env.MST_RPC_URL && !!process.env.ESCROW_ADDRESS;
  const readSettled: SettledReader =
    deps.readSettled ??
    (!deps.readDeal || haveChainEnv
      ? (({ rpcUrl, escrow }) => createSettledReader(rpcUrl, escrow, BigInt(process.env.DEPLOY_BLOCK || "0")))(chainEnv())
      : async () => {
          throw new Error("no Settled reader configured (set MST_RPC_URL and ESCROW_ADDRESS, or inject readSettled)");
        });
  const store = deps.store ?? new SowStore();
  const wasm: Promise<SplitWasm> = loadSplitWasm(deps.wasmBytes ?? defaultWasmBytes());

  const router = express.Router();

  router.get("/deals/:id/verify", async (req, res) => {
    const idParam = String(req.params.id);
    if (!/^\d+$/.test(idParam)) return void res.status(400).json({ error: { code: "BadRequest", message: "deal id must be a non-negative integer" } });
    const dealId = Number(idParam);

    let deal: OnchainDeal;
    try {
      deal = await readDeal(BigInt(idParam));
    } catch (err) {
      return void res.status(502).json({ error: { code: "ChainUnavailable", message: `could not read the deal from MST: ${err instanceof Error ? err.message : String(err)}` } });
    }
    if (deal.status === 0) return void res.status(404).json({ error: { code: "NotFound", message: "deal not found on-chain" } });

    const onchain = {
      reasoningHash: deal.reasoningHash.toLowerCase(),
      proposedBuyerBps: deal.proposedBuyerBps,
      status: DEAL_STATUS[deal.status] ?? `Unknown(${deal.status})`,
    };
    if (onchain.reasoningHash === ZERO_HASH) return void res.status(404).json({ error: { code: "NoRuling", message: "no ruling" } });

    const reasoning = store.getRuling(onchain.reasoningHash) as AnyReasoning | undefined;
    if (!reasoning) {
      // e.g. a human arbitrator's ruling (arbitrate() sets reasoningHash) whose JSON isn't stored with us.
      return void res.json({ dealId, source: "arbitrator-or-unknown", verifiable: false, onchain });
    }
    const source = reasoning.source === "arbitrator" ? "arbitrator" : "agent";

    const stored = store.getSowForDeal(dealId);
    if (!stored) {
      return void res.json({ dealId, source, verifiable: false, reason: "no linked draft/SOW for this deal", reasoning, onchain });
    }

    // Arbitrator rulings leave proposedBuyerBps stale; the payout in Settled is what proves the ruling was applied.
    let settled: { toBuyer: bigint; toSeller: bigint } | null = null;
    if (onchain.status === "Resolved") {
      try {
        settled = await readSettled(BigInt(idParam));
      } catch (err) {
        return void res.status(502).json({ error: { code: "ChainUnavailable", message: `could not read Settled from MST: ${err instanceof Error ? err.message : String(err)}` } });
      }
    }
    const sow = parseSow(JSON.parse(stored.sowJson));
    const result = verifyRuling({
      reasoning,
      onchainReasoningHash: onchain.reasoningHash,
      onchainProposedBps: onchain.proposedBuyerBps,
      settled: settled ? { toBuyer: settled.toBuyer, amount: settled.toBuyer + settled.toSeller } : undefined,
      sow,
      wasm: await wasm,
    });
    const onchainOut = settled ? { ...onchain, settled: { toBuyer: settled.toBuyer.toString(), toSeller: settled.toSeller.toString() } } : onchain;
    res.json({ dealId, source, verifiable: true, reasoning, sow, onchain: onchainOut, result });
  });

  router.use("/deals/:id/verify", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[verify] unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: { code: "Internal", message: "internal error" } });
  });

  return router;
}
