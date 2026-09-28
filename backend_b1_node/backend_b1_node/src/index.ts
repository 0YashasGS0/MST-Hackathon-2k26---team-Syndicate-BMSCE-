import "dotenv/config";
import express from "express";
import cors from "cors";
import { kycRouter } from "./routes/kyc";
import { dealsRouter } from "./routes/deals";
import { startIndexer } from "./indexer";
import "./db"; // ensures tables exist on boot

const app = express();
app.use(cors()); // tighten origin: to the real frontend URL before the demo
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use(kycRouter);
app.use(dealsRouter);

const PORT = Number(process.env.PORT ?? 5000);
app.listen(PORT, () => {
  console.log(`[backend] listening on :${PORT}`);
  startIndexer().catch((err) => console.error("[indexer] failed to start:", err));
});
