import "dotenv/config";
import express from "express";
import cors from "cors";
import { kycRouter } from "./routes/kyc.js";
import { dealsRouter } from "./routes/deals.js";
import { resolveRouter } from "./routes/resolve.js";
import { startIndexer } from "./indexer.js";
import { getCaller } from "./auth.js";
import { createPgIntegration } from "./payments/b1-integration.js";
import { setGasDrip } from "./pg.js";
import { createSowRouter, createDisputeRouter } from "./sow/index.js";
import { sowStore } from "./sowStore.js";
import { pub, org, escrowAbi, usdAbi, ESCROW, USD, sendContractTx } from "./chain.js";
import { db } from "./db.js"; // ensures tables exist on boot

const app = express();
app.use(cors()); // tighten origin: to the real frontend URL before the demo
app.use(express.json());

app.get("/health", async (_req, res) => {
  try {
    const chainId = await pub.getChainId();
    const block = await pub.getBlockNumber();
    const dbOk = db.prepare("SELECT 1").get();
    res.json({ status: "ok", chainId: Number(chainId), latestBlock: Number(block), dbOk: !!dbOk, wallets: !!org });
  } catch (err: any) {
    res.status(500).json({ error: { code: "HealthCheckFailed", message: err.message } });
  }
});

app.use(kycRouter);
app.use(dealsRouter);
app.use(resolveRouter);

// PG modules: session login + payments on the same DB and chain clients. Needs the ORG wallet and deployed contracts.
if (org && ESCROW && USD) {
  const pg = createPgIntegration({
    database: db,
    publicClient: pub,
    orgClient: org,
    escrowAddress: ESCROW,
    usdAddress: USD,
    escrowAbi,
    usdAbi,
    sendContractTx,
  });
  app.use(pg.authRouter);
  app.use(pg.paymentsRouter);
  setGasDrip(pg.gasDripAddress);
} else {
  console.warn("[backend] ORG_KEY / ESCROW_ADDRESS / USD_ADDRESS not set: PG auth + payments routes are not mounted");
}

// B2 modules (merge plan): one SowStore on this connection, PG's getCaller as the only identity source.
app.use(createSowRouter({ store: sowStore, getCaller }));
app.use(createDisputeRouter({ store: sowStore, getCaller }));

const PORT = Number(process.env.PORT ?? 5000);
app.listen(PORT, () => {
  console.log(`[backend] listening on :${PORT}`);
  startIndexer().catch((err: any) => console.error("[indexer] failed to start:", err));
});
