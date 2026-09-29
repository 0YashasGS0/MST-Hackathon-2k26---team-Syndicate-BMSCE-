// Read-only check that a /link request points at the real on-chain DealProposed for this draft.
// TODO(B1): replace with an indexer lookup (chain_events) at merge time.
import { createPublicClient, http, parseAbiItem, parseEventLogs, type Hex, type TransactionReceipt } from "viem";

export const DEAL_PROPOSED = parseAbiItem(
  "event DealProposed(uint256 indexed id, address indexed buyer, address indexed seller, uint256 amount, bytes32 sowHash)",
);

export type LinkExpectation = {
  txHash: string;
  dealId: number;
  buyer: string;
  seller: string;
  amount: string; // base units
  sowHash: string;
};

export type LinkResult = { ok: true } | { ok: false; reason: string };
/** Resolves ok/mismatch; rejects only on infrastructure errors (RPC down, etc.). */
export type LinkVerifier = (e: LinkExpectation) => Promise<LinkResult>;

type ReceiptLike = Pick<TransactionReceipt, "status" | "to" | "logs">;
export type ReceiptFetcher = (hash: Hex) => Promise<ReceiptLike | null>;

export function createLinkVerifier(opts: { rpcUrl: string; escrowAddress: string; getReceipt?: ReceiptFetcher }): LinkVerifier {
  const escrow = opts.escrowAddress.toLowerCase();
  const getReceipt: ReceiptFetcher =
    opts.getReceipt ??
    (() => {
      const client = createPublicClient({ transport: http(opts.rpcUrl) });
      return async (hash) => {
        try {
          return await client.getTransactionReceipt({ hash });
        } catch (err) {
          if (err instanceof Error && err.name === "TransactionReceiptNotFoundError") return null;
          throw err;
        }
      };
    })();

  return async (e) => {
    const receipt = await getReceipt(e.txHash as Hex);
    if (!receipt) return { ok: false, reason: "transaction receipt not found (not mined yet, or wrong txHash)" };
    return checkReceipt(receipt, e, escrow);
  };
}

export function checkReceipt(receipt: ReceiptLike, e: LinkExpectation, escrow: string): LinkResult {
  if (receipt.status !== "success") return { ok: false, reason: "transaction reverted" };
  if (receipt.to?.toLowerCase() !== escrow) {
    return { ok: false, reason: `transaction was sent to ${receipt.to ?? "(contract creation)"}, not the escrow contract ${escrow}` };
  }
  const events = parseEventLogs({ abi: [DEAL_PROPOSED], logs: receipt.logs, strict: true }).filter(
    (l) => l.address.toLowerCase() === escrow,
  );
  const ev = events.find((l) => l.args.id === BigInt(e.dealId));
  if (!ev) {
    return {
      ok: false,
      reason: events.length
        ? `DealProposed id ${events.map((l) => l.args.id).join(",")} does not match dealId ${e.dealId}`
        : "no DealProposed event from the escrow contract in this transaction",
    };
  }
  const a = ev.args;
  if (a.buyer.toLowerCase() !== e.buyer.toLowerCase()) return { ok: false, reason: `on-chain buyer ${a.buyer} does not match draft buyer ${e.buyer}` };
  if (a.seller.toLowerCase() !== e.seller.toLowerCase()) return { ok: false, reason: `on-chain seller ${a.seller} does not match draft seller ${e.seller}` };
  if (a.amount !== BigInt(e.amount)) return { ok: false, reason: `on-chain amount ${a.amount} does not match SOW amount ${e.amount}` };
  if (a.sowHash.toLowerCase() !== e.sowHash.toLowerCase()) {
    return { ok: false, reason: `on-chain sowHash ${a.sowHash} does not match the approved SOW hash ${e.sowHash}` };
  }
  return { ok: true };
}
