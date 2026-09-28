import "dotenv/config";
import express from "express";
import cors from "cors";
import { kycRouter } from "./routes/kyc";
import { dealsRouter } from "./routes/deals";
import { resolveRouter } from "./routes/resolve";
import { paymentsRouter } from "./routes/payments";
import { startIndexer } from "./indexer";
import "./db"; // ensures tables exist on boot

const app = express();
app.use(cors()); // tighten origin: to the real frontend URL before the demo
app.use(express.json());

import { pub, org, agent, arbitrator } from "./chain";
import { db } from "./db";

app.get("/health", async (_req, res) => {
  try {
    const chainId = await pub.getChainId();
    const block = await pub.getBlockNumber();
    const dbOk = db.prepare("SELECT 1").get();
    res.json({ status: "ok", chainId: Number(chainId), latestBlock: Number(block), dbOk: !!dbOk, wallets: true });
  } catch (err: any) {
    res.status(500).json({ error: "health check failed", message: err.message });
  }
});

app.use(kycRouter);
app.use(dealsRouter);
app.use(resolveRouter);
app.use(paymentsRouter); // PG's routes, mounted in the same app + same auth

const PORT = Number(process.env.PORT ?? 5000);
app.listen(PORT, () => {
  console.log(`[backend] listening on :${PORT}`);
  startIndexer().catch((err) => console.error("[indexer] failed to start:", err));
});
