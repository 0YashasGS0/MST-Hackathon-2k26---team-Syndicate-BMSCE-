"""Chain event indexer.

Polls eth_getLogs over HTTP (robust; ~3s blocks make the UI feel live). Progress is stored in
`meta.last_block`, and every event row is keyed by (tx_hash, log_index), so a restart resumes
where it left off and re-processing is harmless. Set DEPLOY_BLOCK so a fresh DB backfills fully.
"""
import json
import logging
import threading
import time

from web3 import Web3

from .chain import STATUS

log = logging.getLogger("indexer")
CHUNK = 2000

EVENT_STATUS = {
    "DealProposed": "Proposed", "DealAccepted": "Accepted", "DealCancelled": "Cancelled",
    "DealFunded": "Funded", "DeliveryMarked": "Delivered", "DisputeRaised": "Disputed",
    "ResolutionProposed": "ResolutionProposed", "Escalated": "Escalated",
}


def _jsonable(v):
    if isinstance(v, (bytes, bytearray)):
        return "0x" + bytes(v).hex()
    if isinstance(v, int):
        return str(v) if abs(v) > 2**53 else v
    return v


class Indexer:
    def __init__(self, chain, db, cfg):
        self.chain, self.db, self.cfg = chain, db, cfg
        self._stop = threading.Event()
        self._thread = None
        self._block_ts = {}
        self.last_error = None
        self.topics = {}
        if chain.escrow:
            for ev in chain.escrow.events:
                e = ev()
                self.topics[Web3.keccak(text=self._sig(e.abi)).hex().removeprefix("0x")] = e

    @staticmethod
    def _sig(abi):
        return f'{abi["name"]}({",".join(i["type"] for i in abi["inputs"])})'

    # ---------------------------------------------------------------- control
    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, name="indexer", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _loop(self):
        while not self._stop.is_set():
            try:
                self.sync_once()
                self.last_error = None
            except Exception as e:  # never die: RPC hiccups are normal
                self.last_error = str(e)[:200]
                log.warning("indexer error: %s", e)
            self._stop.wait(self.cfg.INDEXER_POLL_SECONDS)

    # ------------------------------------------------------------------- sync
    def cursor(self):
        v = self.db.get_meta("last_block")
        return int(v) if v is not None else max(self.cfg.DEPLOY_BLOCK - 1, -1)

    def sync_once(self) -> int:
        """Process all new blocks. Returns number of events stored. Safe to call from tests."""
        if not self.chain.escrow:
            return 0
        latest = self.chain.latest_block()
        start = self.cursor() + 1
        stored = 0
        while start <= latest:
            end = min(start + CHUNK - 1, latest)
            logs = self.chain.w3.eth.get_logs({"address": self.chain.escrow_address, "fromBlock": start, "toBlock": end})
            for lg in sorted(logs, key=lambda l: (l["blockNumber"], l["logIndex"])):
                stored += self._handle(lg)
            self.db.set_meta("last_block", end)
            start = end + 1
        return stored

    def _ts(self, block):
        if block not in self._block_ts:
            if len(self._block_ts) > 500:
                self._block_ts.clear()
            self._block_ts[block] = self.chain.w3.eth.get_block(block)["timestamp"]
        return self._block_ts[block]

    def _handle(self, lg) -> int:
        t0 = lg["topics"][0].hex().removeprefix("0x")
        ev = self.topics.get(t0)
        if ev is None:
            return 0
        parsed = ev.process_log(lg)
        name, args = parsed["event"], dict(parsed["args"])
        deal_id = args.get("id")
        tx_hash = lg["transactionHash"].hex()
        tx_hash = tx_hash if tx_hash.startswith("0x") else "0x" + tx_hash
        with self.db.conn() as c:
            cur = c.execute(
                "INSERT OR IGNORE INTO chain_events(tx_hash,log_index,deal_id,name,args_json,block,block_ts) VALUES(?,?,?,?,?,?,?)",
                (tx_hash, lg["logIndex"], deal_id, name,
                 json.dumps({k: _jsonable(v) for k, v in args.items()}), lg["blockNumber"], self._ts(lg["blockNumber"])))
            if cur.rowcount == 0:      # already indexed
                return 0
            if name == "DealProposed":
                c.execute(
                    "INSERT OR IGNORE INTO deals(id,buyer,seller,amount,status,sow_hash,created_at) VALUES(?,?,?,?,?,?,?)",
                    (deal_id, args["buyer"], args["seller"], str(args["amount"]), "Proposed",
                     "0x" + bytes(args["sowHash"]).hex(), self._ts(lg["blockNumber"])))
            elif name == "Settled":
                c.execute("UPDATE deals SET status=? WHERE id=?", (STATUS[args["finalStatus"]], deal_id))
            elif name in EVENT_STATUS:
                c.execute("UPDATE deals SET status=? WHERE id=?", (EVENT_STATUS[name], deal_id))
        return 1
