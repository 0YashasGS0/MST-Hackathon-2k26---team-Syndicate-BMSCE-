// B2: SOW negotiation endpoints (/drafts/*). Self-contained Router; B1 mounts it with app.use(createSowRouter()).
import express, { type Request, type Response, type NextFunction, type Router } from "express";
import { z } from "zod";
import { hashSow, parseSow } from "@kernel-exploits/shared";
import { llmFromEnv, type LlmClient } from "../agent/llm";
import { LlmUnavailableError, MERGE_PROMPT_VERSION, SowMergeError, mergeSow } from "../agent/mergeSow";
import { SowStore, type Draft } from "./store";

export type SowRouterDeps = {
  store?: SowStore;
  llm?: LlmClient;
  usdAddress?: string; // default env USD_ADDRESS
  demoFallback?: boolean; // default env AGENT_DEMO_FALLBACK === "true"
  now?: () => number; // unix seconds; injectable for tests
};

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address")
  .transform((a) => a.toLowerCase());

const CreateDraftBody = z
  .object({
    buyer: address,
    seller: address,
    purpose: z.string().trim().min(1).max(2000),
    buyerConstraints: z.string().trim().min(1).max(5000),
    amount: z.string().regex(/^[1-9][0-9]*$/, "must be a positive base-unit integer string"),
    deliveryDeadline: z.number().int().positive(),
    reviewWindowSecs: z.number().int().positive(),
  })
  .strict();

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

export function createSowRouter(deps: SowRouterDeps = {}): Router {
  const store = deps.store ?? new SowStore();
  const llm = deps.llm ?? llmFromEnv();
  const usdAddress = (deps.usdAddress ?? process.env.USD_ADDRESS ?? "").toLowerCase();
  const demoFallback = deps.demoFallback ?? process.env.AGENT_DEMO_FALLBACK === "true";
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  const router = express.Router();
  router.use("/drafts", express.json({ limit: "100kb" }));

  // TODO(PG): replace x-user-address with the real session (SARAL / wallet signature) once /auth/* lands.
  function caller(req: Request): string {
    const parsed = address.safeParse(req.header("x-user-address"));
    if (!parsed.success) throw new HttpError(401, "Unauthenticated", "x-user-address header with a valid address is required");
    return parsed.data;
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
    if (b.buyer !== who) throw new HttpError(403, "Forbidden", "only the buyer can create a draft (x-user-address must equal buyer)");
    if (b.buyer === b.seller) throw new HttpError(400, "BadRequest", "buyer and seller must differ");
    if (b.deliveryDeadline <= now()) throw new HttpError(400, "BadRequest", "deliveryDeadline must be in the future");
    res.status(201).json(store.createDraft(b, now()));
  });

  router.get("/drafts/:id", (req, res) => {
    const draft = loadDraft(req);
    requireParty(draft, caller(req));
    res.json(withLatest(draft));
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
    if (!/^0x[0-9a-f]{40}$/.test(usdAddress)) throw new HttpError(500, "Misconfigured", "USD_ADDRESS is not set");

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
        onCall: (c) =>
          store.logAgentCall({ draftId: draft.id, kind: "merge-sow", promptVersion: MERGE_PROMPT_VERSION, ...c }, now()),
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
        throw new HttpError(409, "DeadlinePassed", "SOW deliveryDeadline is in the past; proposeDeal would revert. Create a new draft.");
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

  // TODO(B1): optionally verify txHash's DealProposed event (dealId, sowHash) via the indexer before linking.
  router.post("/drafts/:id/link", (req, res) => {
    const draft = loadDraft(req);
    if (requireParty(draft, caller(req)) !== "buyer") throw new HttpError(403, "Forbidden", "only the buyer links the proposed deal");
    if (draft.status !== "approved") throw new HttpError(409, "BadStatus", `cannot link in status ${draft.status}`);
    const { dealId, txHash } = body(LinkBody, req);
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
