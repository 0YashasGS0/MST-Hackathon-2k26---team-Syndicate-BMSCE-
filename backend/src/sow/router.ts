// B2: SOW negotiation endpoints (/drafts/*). Self-contained Router; B1 mounts it with app.use(createSowRouter()).
import express, { type Request, type Response, type NextFunction, type Router } from "express";
import { z } from "zod";
import { hashSow, parseSow } from "@kernel-exploits/shared";
import { createLlmClient } from "../agent/createLlmClient";
import type { LlmClient } from "../agent/llm";
import { LlmUnavailableError, MERGE_PROMPT_VERSION, SowMergeError, mergeSow } from "../agent/mergeSow";
import { getCaller } from "./auth";
import { SowStore, type Draft } from "./store";
import { createLinkVerifier, type LinkVerifier } from "./verifyLink";

export type SowRouterDeps = {
  store?: SowStore;
  llm?: LlmClient;
  usdAddress?: string; // default env USD_ADDRESS
  demoFallback?: boolean; // default env AGENT_DEMO_FALLBACK === "true"
  /** Injectable for tests; default is a viem verifier built from env MST_RPC_URL + ESCROW_ADDRESS. */
  verifyLink?: LinkVerifier;
  now?: () => number; // unix seconds; injectable for tests
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const address = z
  .string()
  .regex(ADDRESS_RE, "must be a 0x-prefixed 20-byte address")
  .transform((a) => a.toLowerCase());
const baseUnits = z.string().regex(/^[1-9][0-9]*$/, "must be a positive base-unit integer string");

const CreateDraftBody = z
  .object({
    buyer: address,
    seller: address,
    purpose: z.string().trim().min(1).max(2000),
    buyerConstraints: z.string().trim().min(1).max(5000),
    amount: baseUnits,
    deliveryDeadline: z.number().int().positive(),
    reviewWindowSecs: z.number().int().positive(),
  })
  .strict();

const TermsBody = z
  .object({
    amount: baseUnits.optional(),
    deliveryDeadline: z.number().int().positive().optional(),
    reviewWindowSecs: z.number().int().positive().optional(),
  })
  .strict()
  .refine((t) => Object.keys(t).length > 0, "provide at least one of amount, deliveryDeadline, reviewWindowSecs");

const SellerInputBody = z.object({ sellerPoints: z.string().trim().min(1).max(5000) }).strict();
const ApproveBody = z.object({ party: z.enum(["buyer", "seller"]), version: z.number().int().positive() }).strict();
const LinkBody = z
  .object({
    dealId: z.number().int().nonnegative(),
    txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "must be a 0x-prefixed 32-byte hash"),
  })
  .strict();

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Throws at construction (not at request time) if required config is missing. */
function requireEnv(name: string, value: string | undefined, valid: (v: string) => boolean): string {
  if (!value) throw new Error(`createSowRouter: missing required env ${name}`);
  if (!valid(value)) throw new Error(`createSowRouter: env ${name} is invalid`);
  return value;
}

export function createSowRouter(deps: SowRouterDeps = {}): Router {
  const usdAddress = requireEnv("USD_ADDRESS", deps.usdAddress ?? process.env.USD_ADDRESS, (v) => ADDRESS_RE.test(v)).toLowerCase();
  const verifyLink =
    deps.verifyLink ??
    createLinkVerifier({
      rpcUrl: requireEnv("MST_RPC_URL", process.env.MST_RPC_URL, (v) => /^https?:\/\//.test(v)),
      escrowAddress: requireEnv("ESCROW_ADDRESS", process.env.ESCROW_ADDRESS, (v) => ADDRESS_RE.test(v)),
    });
  const store = deps.store ?? new SowStore();
  const llm = deps.llm ?? createLlmClient(); // throws at startup on bad LLM_PROVIDER / missing gemini LLM_MODEL
  const demoFallback = deps.demoFallback ?? process.env.AGENT_DEMO_FALLBACK === "true";
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  const router = express.Router();
  router.use("/drafts", express.json({ limit: "100kb" }));

  function caller(req: Request): string {
    const who = getCaller(req);
    if (!who) throw new HttpError(401, "Unauthenticated", "caller identity is required");
    return who;
  }

  function loadDraft(req: Request): Draft {
    const draft = store.getDraft(String(req.params.id));
    if (!draft) throw new HttpError(404, "NotFound", "draft not found");
    return draft;
  }

  function requireParty(draft: Draft, who: string): "buyer" | "seller" {
    if (who === draft.buyer) return "buyer";
    if (who === draft.seller) return "seller";
    throw new HttpError(403, "Forbidden", "caller is not a party to this draft");
  }

  function body<T extends z.ZodType>(schema: T, req: Request): z.infer<T> {
    const r = schema.safeParse(req.body ?? {});
    if (!r.success) {
      throw new HttpError(400, "BadRequest", "invalid request body", r.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`));
    }
    return r.data;
  }

  function withLatest(draft: Draft) {
    const v = store.getLatestVersion(draft.id);
    return {
      ...draft,
      latestSow: v
        ? {
            version: v.version,
            sow: JSON.parse(v.sowJson),
            sowHash: v.sowHash,
            conflicts: v.conflicts,
            approvals: { buyer: v.buyerApproved, seller: v.sellerApproved },
          }
        : null,
    };
  }

  // Buyer opens a draft. Money, deadline and review window are fixed here and copied verbatim into every SOW.
  router.post("/drafts", (req, res) => {
    const who = caller(req);
    const b = body(CreateDraftBody, req);
    if (b.buyer !== who) throw new HttpError(403, "Forbidden", "only the buyer can create a draft (caller must equal buyer)");
    if (b.buyer === b.seller) throw new HttpError(400, "BadRequest", "buyer and seller must differ");
    if (b.deliveryDeadline <= now()) throw new HttpError(400, "BadRequest", "deliveryDeadline must be in the future");
    res.status(201).json(store.createDraft(b, now()));
  });

  router.get("/drafts/:id", (req, res) => {
    const draft = loadDraft(req);
    requireParty(draft, caller(req));
    res.json(withLatest(draft));
  });

  // Buyer changes server-owned terms. If a SOW exists, a new version is rebuilt from it (no LLM call); approvals reset.
  router.patch("/drafts/:id/terms", (req, res) => {
    const draft = loadDraft(req);
    if (requireParty(draft, caller(req)) !== "buyer") throw new HttpError(403, "Forbidden", "only the buyer can edit terms");
    if (draft.status === "linked") throw new HttpError(409, "BadStatus", "draft is already linked to an on-chain deal");
    const t = body(TermsBody, req);
    const terms = {
      amount: t.amount ?? draft.amount,
      deliveryDeadline: t.deliveryDeadline ?? draft.deliveryDeadline,
      reviewWindowSecs: t.reviewWindowSecs ?? draft.reviewWindowSecs,
    };
    if (terms.deliveryDeadline <= now()) throw new HttpError(400, "BadRequest", "deliveryDeadline must be in the future");

    const latest = store.getLatestVersion(draft.id);
    store.db.transaction(() => {
      store.updateTerms(draft.id, terms, now());
      if (!latest) return;
      const sow = parseSow({ ...JSON.parse(latest.sowJson), ...terms });
      const changes = (Object.keys(terms) as (keyof typeof terms)[])
        .filter((k) => terms[k] !== draft[k])
        .map((k) => `${k} ${draft[k]} → ${terms[k]}`);
      const note = `[server] Buyer updated terms in v${latest.version + 1}: ${changes.join(", ") || "no change"}`;
      store.addVersion(draft.id, JSON.stringify(sow), hashSow(sow), [...latest.conflicts, note], now());
    })();
    res.json(withLatest(store.getDraft(draft.id)!));
  });

  router.post("/drafts/:id/seller-input", (req, res) => {
    const draft = loadDraft(req);
    if (requireParty(draft, caller(req)) !== "seller") throw new HttpError(403, "Forbidden", "only the seller can add seller input");
    if (draft.status === "linked") throw new HttpError(409, "BadStatus", "draft is already linked to an on-chain deal");
    const { sellerPoints } = body(SellerInputBody, req);
    res.json(store.setSellerPoints(draft.id, sellerPoints, now()));
  });

  router.post("/drafts/:id/merge-sow", async (req, res) => {
    const draft = loadDraft(req);
    requireParty(draft, caller(req));
    if (draft.status === "linked") throw new HttpError(409, "BadStatus", "draft is already linked to an on-chain deal");
    if (!draft.sellerPoints) throw new HttpError(409, "BadStatus", "waiting for seller input");

    const result = await mergeSow(
      {
        buyer: draft.buyer,
        seller: draft.seller,
        purpose: draft.purpose,
        buyerConstraints: draft.buyerConstraints,
        sellerPoints: draft.sellerPoints,
        amount: draft.amount,
        deliveryDeadline: draft.deliveryDeadline,
        reviewWindowSecs: draft.reviewWindowSecs,
      },
      {
        llm,
        token: usdAddress,
        demoFallback,
        onCall: (c) => store.logAgentCall({ subject: `draft:${draft.id}`, kind: "merge-sow", promptVersion: MERGE_PROMPT_VERSION, ...c }, now()),
      },
    );
    const sowHash = hashSow(result.sow);
    const v = store.addVersion(draft.id, JSON.stringify(result.sow), sowHash, result.conflicts, now());
    res.json({ version: v.version, sow: result.sow, sowHash, conflicts: result.conflicts });
  });

  router.post("/drafts/:id/approve-sow", (req, res) => {
    const draft = loadDraft(req);
    const role = requireParty(draft, caller(req));
    const { party, version } = body(ApproveBody, req);
    if (party !== role) throw new HttpError(403, "Forbidden", `caller is the ${role}, cannot approve as ${party}`);
    if (draft.status !== "sow_proposed" && draft.status !== "approved") {
      throw new HttpError(409, "BadStatus", `cannot approve in status ${draft.status}`);
    }
    const latest = store.getLatestVersion(draft.id);
    if (!latest || latest.version !== version) {
      throw new HttpError(409, "StaleVersion", `version ${version} is not the latest (latest is ${latest?.version ?? "none"})`);
    }

    // Derive everything from the stored, hashed SOW so proposeDealArgs can never diverge from what was hashed.
    const sow = parseSow(JSON.parse(latest.sowJson));
    const sowHash = hashSow(sow);
    if (sowHash !== latest.sowHash) throw new HttpError(500, "IntegrityError", "stored SOW does not match its hash");

    const other = party === "buyer" ? latest.sellerApproved : latest.buyerApproved;
    if (other) {
      // This approval completes the pair: check the SOW is still proposable before recording it.
      if (sow.deliveryDeadline <= now()) {
        throw new HttpError(409, "DeadlinePassed", "SOW deliveryDeadline is in the past; proposeDeal would revert. Update it via PATCH /drafts/:id/terms.");
      }
      if (sow.token.toLowerCase() !== usdAddress) {
        throw new HttpError(409, "TokenMismatch", "SOW token does not match the deployed stablecoin (USD_ADDRESS)");
      }
    }

    const v = store.approve(draft.id, version, party, now());
    const bothApproved = v.buyerApproved && v.sellerApproved;
    if (!bothApproved) return void res.json({ bothApproved: false, version, sowHash });

    store.setStatus(draft.id, "approved", now());
    res.json({
      bothApproved: true,
      version,
      sowHash,
      proposeDealArgs: {
        seller: sow.seller,
        amount: sow.amount,
        sowHash,
        deliverBy: sow.deliveryDeadline,
        reviewPeriod: sow.reviewWindowSecs,
      },
    });
  });

  // Buyer links the on-chain deal; the tx's DealProposed must match this draft's parties, amount and approved SOW hash.
  router.post("/drafts/:id/link", async (req, res) => {
    const draft = loadDraft(req);
    if (requireParty(draft, caller(req)) !== "buyer") throw new HttpError(403, "Forbidden", "only the buyer links the proposed deal");
    if (draft.status !== "approved") throw new HttpError(409, "BadStatus", `cannot link in status ${draft.status}`);
    const { dealId, txHash } = body(LinkBody, req);
    const approved = store.getLatestVersion(draft.id)!;
    const sow = parseSow(JSON.parse(approved.sowJson));

    let result;
    try {
      result = await verifyLink({ txHash, dealId, buyer: draft.buyer, seller: draft.seller, amount: sow.amount, sowHash: approved.sowHash });
    } catch (err) {
      throw new HttpError(502, "ChainUnavailable", `could not read the transaction from MST: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!result.ok) throw new HttpError(422, "LinkVerificationFailed", result.reason);
    res.json(store.link(draft.id, dealId, txHash.toLowerCase(), now()));
  });

  router.use("/drafts", (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      return void res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) } });
    }
    if (err instanceof SowMergeError) {
      return void res.status(422).json({ error: { code: "SowValidationFailed", message: err.message, details: err.issues } });
    }
    if (err instanceof LlmUnavailableError) {
      return void res.status(502).json({ error: { code: "LlmUnavailable", message: "the SOW agent is unavailable; try again or enable AGENT_DEMO_FALLBACK" } });
    }
    if (err && typeof err === "object" && "type" in err && err.type === "entity.parse.failed") {
      return void res.status(400).json({ error: { code: "BadRequest", message: "malformed JSON body" } });
    }
    console.error("[sow] unhandled error:", err instanceof Error ? err.message : err);
    res.status(500).json({ error: { code: "Internal", message: "internal error" } });
  });

  return router;
}
