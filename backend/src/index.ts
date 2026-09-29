import "dotenv/config";
import { createApp } from "./app.js";
import { startIndexer } from "./indexer.js";

const app = createApp();
const PORT = Number(process.env.PORT ?? 5000);
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`[backend] listening on :${PORT}`);
  startIndexer().catch((err: any) => console.error("[indexer] failed to start:", err?.shortMessage ?? err?.message ?? err));
});
server.headersTimeout = 20_000; // slowloris
server.requestTimeout = 60_000;

for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
