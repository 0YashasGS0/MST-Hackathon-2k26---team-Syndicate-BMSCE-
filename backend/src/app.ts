// The Express app (no listen, no indexer), so tests can drive the real middleware stack.
import express from "express";
import { kycRouter } from "./routes/kyc.js";
import { dealsRouter } from "./routes/deals.js";
import { resolveRouter } from "./routes/resolve.js";
import { getCaller } from "./auth.js";
import { createPgIntegration } from "./payments/b1-integration.js";
import { setGasDrip } from "./pg.js";
import { createSowRouter, createDisputeRouter } from "./sow/index.js";
import { sowStore } from "./sowStore.js";
import { pub, org, escrowAbi, usdAbi, ESCROW, USD, sendContractTx } from "./chain.js";
import { db } from "./db.js"; // ensures tables exist on boot
import { assertSafeConfig, corsMiddleware, errorHandler, rateLimits, securityHeaders } from "./security.js";

/** Hops of reverse proxy in front of us (for the client IP used by rate limits). Default: none. */
function trustProxy(): number | boolean {
  const v = process.env.TRUST_PROXY;
  if (!v || v === "false") return false;
  return /^\d+$/.test(v) ? Number(v) : true;
}

export function createApp() {
  assertSafeConfig(); // production refuses to start with dev auth, weak secrets or a wildcard CORS

  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", trustProxy());
  app.use(securityHeaders());
  app.use(corsMiddleware());
  app.use(rateLimits.global());
  app.use(express.json({ limit: "100kb" }));

  app.get("/health", async (_req, res) => {
    try {
      const block = await pub.getBlockNumber();
      db.prepare("SELECT 1").get();
      res.json({ status: "ok", latestBlock: Number(block), wallets: !!org });
    } catch (err: any) {
      console.error("[health]", err?.shortMessage ?? err?.message ?? err);
      res.status(503).json({ status: "degraded", error: { code: "HealthCheckFailed", message: "chain or database unavailable" } });
    }
  });

  // Tighter per-IP limits where a request costs an LLM call, a wallet transaction, or a sign-in attempt.
  app.use(["/auth/nonce", "/auth/verify", "/auth/saral"], rateLimits.auth());
  app.use(["/deals/:id/resolve", "/deals/:id/timeout", "/drafts/:id/merge-sow", "/onramp", "/admin", "/arbitrator/deals"], rateLimits.expensive());
  app.use(["/kyc/submit", "/deals/:id/delivery", "/deals/:id/evidence"], rateLimits.upload());

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

  app.use((_req, res) => void res.status(404).json({ error: { code: "NotFound", message: "no such route" } }));
  app.use(errorHandler());
  return app;
}
