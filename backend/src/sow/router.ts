// B2: SOW negotiation endpoints (/drafts/*). Self-contained Router; B1 mounts it with app.use(createSowRouter({ store, getCaller })).
// Two-party flow: either side creates a draft with its terms, the other side adds its terms, the agent merges them
// into a SOW, structured conflicts are settled by matching proposals, then both parties sign/approve one version.
import express, { type Request, type Response, type NextFunction, type Router } from "express";
import type Database from "better-sqlite3";
import { recoverMessageAddress, type Hex } from "viem";
import { z } from "zod";
import { hashSow, parseSow } from "@kernel-exploits/shared";
import { createLlmChain } from "../agent/createLlmClient";
import type { LlmChain } from "../agent/toolRetry";
import { LlmUnavailableError, MERGE_PROMPT_VERSION, SowMergeError, mergeSow, type RequestedDeliveryDays } from "../agent/mergeSow";
import { getCaller as defaultGetCaller, type GetCaller } from "./auth";
import { ADDRESS_RE, isAddress, isHttpUrl, requireEnv as requireEnvFor } from "./env";
import { SowStore, type Conflict, type Draft, type Party, type Signature, type StoredSowVersion } from "./store";
import { draftView, sowVersionView } from "./views";
import { createLinkVerifier, type LinkVerifier } from "./verifyLink";

/** May `signer` (a device key) sign SOWs for the signed-in `caller`? */
export type SignerAuthorizer = (caller: string, signer: string) => boolean | Promise<boolean>;

export type SowRouterDeps = {
  store?: SowStore;
  /** Used when no store is given: B1's better-sqlite3 Database or a path (default env DB_PATH). */
  db?: Database.Database | string;
  /** MERGE: B1 passes PG's getCaller from ../auth. The ONLY identity source. Default: x-user-address iff AUTH_DEV_HEADER=true. */
  getCaller?: GetCaller;
  /**
   * approve-sow accepts a signature whose recovered signer is the caller, or a signer this returns true for.
   * MERGE: PG/FE device-key registry (FE signs with a device key, not the wallet). Default: always false.
   */
  isAuthorizedSigner?: SignerAuthorizer;
  llm?: LlmChain;
  usdAddress?: string; // default env USD_ADDRESS
  demoFallback?: boolean; // default env AGENT_DEMO_FALLBACK === "true"
  /** Injectable for tests; default is a viem verifier built from env MST_RPC_URL + ESCROW_ADDRESS. */
  verifyLink?: LinkVerifier;
  defaultDeliveryDays?: number; // POST /drafts without deliveryDeadline: now + this many days (default env DEFAULT_DELIVERY_DAYS or 7)
  defaultReviewSecs?: number; // POST /drafts without reviewWindowSecs (default env DEFAULT_REVIEW_SECS or 172800)
  now?: () => number; // unix seconds; injectable for tests
};

const DAY = 86400;
const address = z
  .string()
  .regex(ADDRESS_RE, "must be a 0x-prefixed 20-byte address")
  .transform((a) => a.toLowerCase());
const baseUnits = z.string().regex(/^[1-9][0-9]*$/, "must be a positive base-unit integer string");
const party = z.enum(["buyer", "seller"]);
const posInt = z.number().int().positive();
const termsText = z.string().trim().min(1).max(5000);
const purposeText = z.string().trim().min(1).max(2000);

/** Two-party create (FE): the caller is the initiator's side; the counterparty is the other side. */
const CreateDraftBody = z
  .object({
    initiator: party,
    counterparty: address,
    purpose: purposeText,
    amount: baseUnits.optional(),
    price: baseUnits.optional(), // alias of amount
    terms: termsText,
    deliveryDeadline: posInt.optional(),
    reviewWindowSecs: posInt.optional(),
  })
  .strict()
  .refine((b) => b.amount !== undefined || b.price !== undefined, { message: "amount (or price) is required", path: ["amount"] })
  .refine((b) => b.amount === undefined || b.price === undefined || b.amount === b.price, { message: "amount and price differ", path: ["price"] });

/** Pre-merge-plan create body (buyer-initiated), still accepted. */
const LegacyCreateDraftBody = z
  .object({
    buyer: address,
    seller: address,
    purpose: purposeText,
    buyerConstraints: termsText,
    amount: baseUnits,
    deliveryDeadline: posInt,
    reviewWindowSecs: posInt,
  })
  .strict();

const PatchTermsBody = z
  .object({
    amount: baseUnits.optional(),
    deliveryDeadline: posInt.optional(),
    reviewWindowSecs: posInt.optional(),
  })
  .strict()
  .refine((t) => Object.keys(t).length > 0, "provide at least one of amount, deliveryDeadline, reviewWindowSecs");

const OtherTermsBody = z.object({ party, terms: termsText }).strict();
const SellerInputBody = z.object({ sellerPoints: termsText }).strict();
const ConflictProposalBody = z.object({ party, field: z.literal("deliveryDeadline"), value: posInt }).strict();
const ApproveBody = z
  .object({
    party,
    version: posInt,
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/, "must be 0x-prefixed hex").optional(),
    pin: z.union([z.string(), z.number()]).optional(), // accepted and ignored: PG/FE device security
  })
  .strict();
const LinkBody = z
  .object({
    dealId: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/).transform(Number)]),
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
const requireEnv = (name: string, value: string | undefined, valid: (v: string) => boolean) => requireEnvFor("createSowRouter", name, value, valid);
const positiveIntEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return Number(requireEnv(name, raw, (v) => /^[1-9][0-9]*$/.test(v)));
};
const other = (p: Party): Party => (p === "buyer" ? "seller" : "buyer");

/** One deliveryDeadline conflict when both sides asked for a different number of days (times from the draft date). */
export function deadlineConflicts(days: RequestedDeliveryDays, draftCreatedAt: number): Conflict[] {
  if (days.buyer === undefined || days.seller === undefined || days.buyer === days.seller) return [];
  return [
    {
      field: "deliveryDeadline",
      label: "Delivery deadline",
      buyerWants: draftCreatedAt + days.buyer * DAY,
      sellerWants: draftCreatedAt + days.seller * DAY,
      proposals: {},
    },
  ];
}

export function createSowRouter(deps: SowRouterDeps = {}): Router {
  const usdAddress = requireEnv("USD_ADDRESS", deps.usdAddress ?? process.env.USD_ADDRESS, isAddress).toLowerCase();
  const verifyLink =
    deps.verifyLink ??
    createLinkVerifier({
      rpcUrl: requireEnv("MST_RPC_URL", process.env.MST_RPC_URL, isHttpUrl),
      escrowAddress: requireEnv("ESCROW_ADDRESS", process.env.ESCROW_ADDRESS, isAddress),
    });
  const store = deps.store ?? new SowStore(deps.db);
  const getCaller = deps.getCaller ?? defaultGetCaller;
  const isAuthorizedSigner: SignerAuthorizer = deps.isAuthorizedSigner ?? (() => false); // MERGE: PG/FE device-key registry
  const llm = deps.llm ?? createLlmChain(); // throws at startup on bad LLM_PROVIDER / missing gemini LLM_MODEL
  const demoFallback = deps.demoFallback ?? process.env.AGENT_DEMO_FALLBACK === "true";
  const defaultDeliveryDays = deps.defaultDeliveryDays ?? positiveIntEnv("DEFAULT_DELIVERY_DAYS", 7);
  const defaultReviewSecs = deps.defaultReviewSecs ?? positiveIntEnv("DEFAULT_REVIEW_SECS", 172800);
  const now = deps.now ?? (() => Math.floor(Date.now() / 1000));

  const router = express.Router();
  router.use("/drafts", express.json({ limit: "100kb" }));

  function caller(req: Request): string {
    const who = getCaller(req);
    if (!who || !ADDRESS_RE.test(who)) throw new HttpError(401, "Unauthorized", "sign in first (no caller identity on this request)");
    return who.toLowerCase();
  }

  function loadDraft(req: Request): Draft {
    const draft = store.getDraft(String(req.params.id));
    if (!draft) throw new HttpError(404, "NotFound", "draft not found");
    return draft;
  }

  function requireParty(draft: Draft, who: string): Party {
    if (who === draft.buyer) return "buyer";
    if (who === draft.seller) return "seller";
    throw new HttpError(403, "Forbidden", "caller is not a party to this draft");
  }

  function actAs(role: Party, claimed: Party, what: string): void {
    if (claimed !== role) throw new HttpError(403, "Forbidden", `caller is the ${role}, cannot ${what} as ${claimed}`);
  }

  function notLinked(draft: Draft): void {
    if (draft.status === "linked") throw new HttpError(409, "BadStatus", "draft is already linked to an on-chain deal");
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
    return { ...draftView(draft), latestSow: v ? sowVersionView(v) : null };
  }

  /** New version from the latest SOW with changed server-owned terms (no LLM call). Approvals and signatures reset. */
  function rebuild(
    draft: Draft,
    latest: StoredSowVersion,
    terms: { amount: string; deliveryDeadline: number; reviewWindowSecs: number },
    note: string,
    conflicts: Conflict[],
  ): StoredSowVersion {
    return store.db.transaction(() => {
      store.updateTerms(draft.id, terms, now());
      const sow = parseSow({ ...JSON.parse(latest.sowJson), ...terms });
      return store.addVersion(draft.id, JSON.stringify(sow), hashSow(sow), [...latest.conflictNotes, note], now(), conflicts);
    })();
  }

  /** The side that did not create the draft adds its terms (POST /drafts/:id/terms and the /seller-input alias). */
  function addOtherTerms(req: Request, claimed: Party, terms: string) {
    const draft = loadDraft(req);
    const role = requireParty(draft, caller(req));
    actAs(role, claimed, "add terms");
    if (claimed === draft.initiator) throw new HttpError(403, "Forbidden", `the ${claimed} created this draft; only the ${other(claimed)} adds terms here`);
    notLinked(draft);
    return draftView(store.setTerms(draft.id, claimed, terms, now()));
  }

  // Either side opens a draft with its own terms. Money, deadline and review window are fixed here and copied into every SOW.
  router.post("/drafts", (req, res) => {
    const who = caller(req);
    const raw = req.body as Record<string, unknown> | undefined;
    let input: Parameters<SowStore["createDraft"]>[0];
    if (raw && typeof raw === "object" && "initiator" in raw) {
      const b = body(CreateDraftBody, req);
      if (b.counterparty === who) throw new HttpError(400, "BadRequest", "counterparty must be the other party, not the caller");
      const [buyer, seller] = b.initiator === "buyer" ? [who, b.counterparty] : [b.counterparty, who];
      input = {
        initiator: b.initiator,
        buyer,
        seller,
        purpose: b.purpose,
        ...(b.initiator === "buyer" ? { buyerConstraints: b.terms } : { sellerPoints: b.terms }),
        amount: (b.amount ?? b.price)!,
        deliveryDeadline: b.deliveryDeadline ?? now() + defaultDeliveryDays * DAY,
        reviewWindowSecs: b.reviewWindowSecs ?? defaultReviewSecs,
      };
    } else {
      const b = body(LegacyCreateDraftBody, req);
      if (b.buyer !== who) throw new HttpError(403, "Forbidden", "only the buyer can create a draft with this body (caller must equal buyer)");
      if (b.buyer === b.seller) throw new HttpError(400, "BadRequest", "buyer and seller must differ");
      input = { ...b, initiator: "buyer" };
    }
    if (input.deliveryDeadline <= now()) throw new HttpError(400, "BadRequest", "deliveryDeadline must be in the future");
    res.status(201).json(draftView(store.createDraft(input, now())));
  });

  // The caller's drafts (as buyer or seller), newest first. ?address defaults to the caller and must equal it.
  router.get("/drafts", (req, res) => {
    const who = caller(req);
    const q = req.query.address;
    if (q !== undefined && (typeof q !== "string" || !ADDRESS_RE.test(q))) throw new HttpError(400, "BadRequest", "address must be a 0x-prefixed 20-byte address");
    if (q !== undefined && q.toLowerCase() !== who) throw new HttpError(403, "Forbidden", "you can only list your own drafts");
    res.json(store.listDraftsFor(who).map(draftView));
  });

  router.get("/drafts/:id", (req, res) => {
    const draft = loadDraft(req);
    requireParty(draft, caller(req));
    res.json(withLatest(draft));
  });

  router.get("/drafts/:id/sow", (req, res) => {
    const draft = loadDraft(req);
    requireParty(draft, caller(req));
    const v = store.getLatestVersion(draft.id);
    res.json(v ? sowVersionView(v) : null);
  });

  router.post("/drafts/:id/terms", (req, res) => {
    const { party: claimed, terms } = body(OtherTermsBody, req);
    res.json(addOtherTerms(req, claimed, terms));
  });

  // Pre-merge-plan alias of POST /drafts/:id/terms { party: "seller" }.
  router.post("/drafts/:id/seller-input", (req, res) => {
    const { sellerPoints } = body(SellerInputBody, req);
    res.json(addOtherTerms(req, "seller", sellerPoints));
  });

  // Buyer changes server-owned terms. If a SOW exists, a new version is rebuilt from it (no LLM call); approvals reset.
  router.patch("/drafts/:id/terms", (req, res) => {
    const draft = loadDraft(req);
    if (requireParty(draft, caller(req)) !== "buyer") throw new HttpError(403, "Forbidden", "only the buyer can edit terms");
    notLinked(draft);
    const t = body(PatchTermsBody, req);
    const terms = {
      amount: t.amount ?? draft.amount,
      deliveryDeadline: t.deliveryDeadline ?? draft.deliveryDeadline,
      reviewWindowSecs: t.reviewWindowSecs ?? draft.reviewWindowSecs,
    };
    if (terms.deliveryDeadline <= now()) throw new HttpError(400, "BadRequest", "deliveryDeadline must be in the future");

    const latest = store.getLatestVersion(draft.id);
    if (!latest) store.updateTerms(draft.id, terms, now());
    else {
      const changes = (Object.keys(terms) as (keyof typeof terms)[])
        .filter((k) => terms[k] !== draft[k])
        .map((k) => `${k} ${draft[k]} → ${terms[k]}`);
      rebuild(draft, latest, terms, `[server] Buyer updated terms in v${latest.version + 1}: ${changes.join(", ") || "no change"}`, latest.conflicts);
    }
    res.json(withLatest(store.getDraft(draft.id)!));
  });

  router.post("/drafts/:id/merge-sow", async (req, res) => {
    const draft = loadDraft(req);
    requireParty(draft, caller(req));
    notLinked(draft);
    if (!draft.sellerPoints || !draft.buyerConstraints) throw new HttpError(409, "BadStatus", "waiting for the other party's terms");

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
        draftCreatedAt: draft.createdAt,
      },
      {
        llm,
        token: usdAddress,
        demoFallback,
        onCall: (c) => store.logAgentCall({ subject: `draft:${draft.id}`, kind: "merge-sow", promptVersion: MERGE_PROMPT_VERSION, ...c }, now()),
      },
    );
    const conflicts = deadlineConflicts(result.requestedDeliveryDays, draft.createdAt);
    const v = store.addVersion(draft.id, JSON.stringify(result.sow), hashSow(result.sow), result.conflictNotes, now(), conflicts);
    res.json(sowVersionView(v));
  });

  // A party proposes a value for an open structured conflict. When both proposals match, the conflict is resolved:
  // a new SOW version is rebuilt with that value (no LLM call, like PATCH /terms) and signatures reset.
  router.post("/drafts/:id/conflicts", (req, res) => {
    const draft = loadDraft(req);
    const role = requireParty(draft, caller(req));
    const { party: claimed, field, value } = body(ConflictProposalBody, req);
    actAs(role, claimed, "propose");
    notLinked(draft);
    const latest = store.getLatestVersion(draft.id);
    const idx = latest ? latest.conflicts.findIndex((c) => c.field === field) : -1;
    if (!latest || idx < 0) throw new HttpError(409, "NoOpenConflict", `no open ${field} conflict on the latest SOW version`);
    if (value <= now()) throw new HttpError(400, "BadRequest", "value must be a future unix time (seconds)");

    const conflicts = latest.conflicts.map((c, i) => (i === idx ? { ...c, proposals: { ...c.proposals, [claimed]: value } } : c));
    if (conflicts[idx].proposals[other(claimed)] !== value) {
      return void res.json(sowVersionView(store.setConflicts(draft.id, latest.version, conflicts, now())));
    }
    const terms = { amount: draft.amount, deliveryDeadline: value, reviewWindowSecs: draft.reviewWindowSecs };
    const note = `[server] Both parties agreed deliveryDeadline ${value} in v${latest.version + 1} (was ${JSON.parse(latest.sowJson).deliveryDeadline})`;
    res.json(sowVersionView(rebuild(draft, latest, terms, note, conflicts.filter((_, i) => i !== idx))));
  });

  // A party approves (optionally signs) the latest version. `pin` is accepted and ignored (PG/FE device security).
  router.post("/drafts/:id/approve-sow", async (req, res) => {
    const draft = loadDraft(req);
    const who = caller(req);
    const role = requireParty(draft, who);
    const { party: claimed, version, signature } = body(ApproveBody, req);
    actAs(role, claimed, "approve");
    if (draft.status !== "sow_proposed" && draft.status !== "approved") {
      throw new HttpError(409, "BadStatus", `cannot approve in status ${draft.status}`);
    }
    const latest = store.getLatestVersion(draft.id);
    if (!latest || latest.version !== version) {
      throw new HttpError(409, "StaleVersion", `version ${version} is not the latest (latest is ${latest?.version ?? "none"})`);
    }
    if (latest.conflicts.length) {
      throw new HttpError(409, "ConflictsOpen", `resolve the open conflicts first (${latest.conflicts.map((c) => c.field).join(", ")}) via POST /drafts/:id/conflicts`);
    }

    // Derive everything from the stored, hashed SOW so proposeDealArgs can never diverge from what was hashed.
    const sow = parseSow(JSON.parse(latest.sowJson));
    const sowHash = hashSow(sow);
    if (sowHash !== latest.sowHash) throw new HttpError(500, "IntegrityError", "stored SOW does not match its hash");

    let sig: Signature | undefined;
    if (signature !== undefined) {
      let signer: string;
      try {
        signer = (await recoverMessageAddress({ message: { raw: sowHash }, signature: signature as Hex })).toLowerCase();
      } catch {
        throw new HttpError(400, "BadSignature", "signature is malformed (expected signMessage({ message: { raw: sowHash } }))");
      }
      if (signer !== who && !(await isAuthorizedSigner(who, signer))) {
        throw new HttpError(403, "SignerNotAuthorized", `signature is by ${signer}, which is neither the caller nor a device key authorized for it`);
      }
      sig = { party: claimed, signer, signature, signedAt: now() };
    }

    const otherApproved = claimed === "buyer" ? latest.sellerApproved : latest.buyerApproved;
    if (otherApproved) {
      // This approval completes the pair: check the SOW is still proposable before recording it.
      if (sow.deliveryDeadline <= now()) {
        throw new HttpError(409, "DeadlinePassed", "SOW deliveryDeadline is in the past; proposeDeal would revert. Update it via PATCH /drafts/:id/terms.");
      }
      if (sow.token.toLowerCase() !== usdAddress) {
        throw new HttpError(409, "TokenMismatch", "SOW token does not match the deployed stablecoin (USD_ADDRESS)");
      }
    }

    const v = store.db.transaction(() => {
      // Re-check after the await: a new version may have been created meanwhile.
      if (store.getLatestVersion(draft.id)?.version !== version) throw new HttpError(409, "StaleVersion", `version ${version} is no longer the latest`);
      if (sig) store.addSignature(draft.id, version, sig);
      const approved = store.approve(draft.id, version, claimed, now());
      if (approved.buyerApproved && approved.sellerApproved) store.setStatus(draft.id, "approved", now());
      return approved;
    })();
    const bothApproved = v.buyerApproved && v.sellerApproved;
    res.json({
      ...sowVersionView(v),
      bothApproved,
      ...(bothApproved && {
        proposeDealArgs: { seller: sow.seller, amount: sow.amount, sowHash, deliverBy: sow.deliveryDeadline, reviewPeriod: sow.reviewWindowSecs },
      }),
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
    res.json(draftView(store.link(draft.id, dealId, txHash.toLowerCase(), now())));
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
