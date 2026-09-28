// Event indexer, per TEAM_ROADMAP.md §1 "Hour 1-3 step 3":
// pub.watchContractEvent over the WebSocket RPC. For each log: insert into
// chain_events (idempotent via the (tx_hash, log_index) primary key), update
// deals.status, and on startup backfill with getContractEvents from DEPLOY_BLOCK
// so a restart never loses history.
import { pub, escrowAbi, ESCROW } from "./chain";
import { db } from "./db";

const insertEvent = db.prepare(`
  INSERT OR IGNORE INTO chain_events (tx_hash, log_index, deal_id, name, args_json, block)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const upsertDealStatus = db.prepare(`
  INSERT INTO deals (id, buyer, seller, amount, status)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET status = excluded.status
`);

function stringifyArgs(args: Record<string, any>) {
  const safe: Record<string, any> = {};
  for (const [k, v] of Object.entries(args)) {
    safe[k] = typeof v === "bigint" ? v.toString() : v;
  }
  return JSON.stringify(safe);
}

function storeLog(log: any) {
  const dealId = log.args?.id !== undefined ? Number(log.args.id) : null;
  insertEvent.run(
    log.transactionHash,
    log.logIndex,
    dealId,
    log.eventName,
    stringifyArgs(log.args ?? {}),
    Number(log.blockNumber)
  );
  if (dealId !== null) {
    upsertDealStatus.run(
      dealId,
      log.args?.buyer ?? "",
      log.args?.seller ?? "",
      log.args?.amount?.toString() ?? "",
      log.eventName
    );
  }
}

export async function startIndexer() {
  if (!ESCROW) {
    console.log("[indexer] ESCROW_ADDRESS not set yet, indexer idle.");
    return;
  }

  const deployBlock = BigInt(process.env.DEPLOY_BLOCK ?? "0");
  const row = db.prepare("SELECT MAX(block) as m FROM chain_events").get() as { m: number | null };
  const fromBlock = row?.m != null ? BigInt(row.m + 1) : deployBlock;

  console.log(`[indexer] backfilling from block ${fromBlock}`);
  const pastLogs = await pub.getContractEvents({
    address: ESCROW,
    abi: escrowAbi,
    fromBlock,
  });
  for (const log of pastLogs) storeLog(log);
  console.log(`[indexer] backfilled ${pastLogs.length} events, now watching live`);

  pub.watchContractEvent({
    address: ESCROW,
    abi: escrowAbi,
    onLogs: (logs) => logs.forEach(storeLog),
    onError: (err) => console.error("[indexer] watch error:", err),
  });
}
