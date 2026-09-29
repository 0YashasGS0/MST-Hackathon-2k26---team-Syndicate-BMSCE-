// Typed API client. Every endpoint goes to the shared fake backend (/api/mock → lib/mocks.ts) until it is
// listed in NEXT_PUBLIC_LIVE_ENDPOINTS (comma-separated keys below, or "*"), so we can switch to the live
// backend one endpoint at a time.
import type { Address, Hex } from "viem";
import type {
  ApiUser,
  Attachment,
  AuthNonce,
  AuthResult,
  Complaint,
  Conflict,
  Contact,
  Deal,
  Draft,
  LoginResult,
  NewDraft,
  OnrampConfirm,
  OnrampSession,
  Party,
  PayMethod,
  Resolution,
  SowVersion,
  User,
} from "./types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000").replace(/\/$/, "");
// Application-level key the backend checks on every route (X-API-Key). It ships to the browser, so it is not
// a secret; the per-user identity is PG's HttpOnly session cookie.
const API_KEY = process.env.NEXT_PUBLIC_API_KEY ?? "";
const LIVE = new Set((process.env.NEXT_PUBLIC_LIVE_ENDPOINTS ?? "").split(",").map((s) => s.trim()));
const isLive = (key: string) => LIVE.has("*") || LIVE.has(key);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function http<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = API_KEY ? { "x-api-key": API_KEY } : {};
  // The session cookie is set by PG's /auth/verify on the backend origin, so send it cross-origin too.
  const init: RequestInit = { method, headers, credentials: "include" };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    // docs/API.md: { error: { code, message } }; some routes still send { error: "text" }.
    const msg = typeof err.error === "object" ? err.error?.message : err.error ?? err.message;
    throw new ApiError(res.status, msg || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function rpc<T>(fn: string, ...args: unknown[]): Promise<T> {
  const res = await fetch("/api/mock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fn, args }),
  });
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new ApiError(res.status, body.error ?? "Something went wrong");
  return body.result as T;
}

/** `key` is both the NEXT_PUBLIC_LIVE_ENDPOINTS switch and the mock function name. */
const call = <T>(key: string, live: () => Promise<T>, ...mockArgs: unknown[]) =>
  isLive(key) ? live() : rpc<T>(key, ...mockArgs);

const fileMeta = (files: File[]): Attachment[] => files.map((f) => ({ name: f.name, type: f.type, size: f.size }));

// Live on-chain actions: the backend stores files/notes and returns the hash, the user's own wallet signs the
// DealEscrow call (the backend never moves funds for users), then the updated deal is read back.
// Loaded lazily: onchain.ts → wallet.ts imports this module.
const escrow = async (fn: Parameters<typeof import("./onchain").sendEscrow>[0], args: readonly unknown[]) =>
  (await import("./onchain")).sendEscrow(fn, args);
const dealId = (id: string) => BigInt(id);

export const api = {
  // ---- wallet sign-in (PG) ----
  authNonce: (address: Address) =>
    call<AuthNonce>("authNonce", () => http("GET", `/auth/nonce?address=${address}`), address),
  authVerify: (message: string, signature: Hex) =>
    call<AuthResult>("authVerify", () => http("POST", "/auth/verify", { message, signature }), message, signature),
  logout: () => call<void>("logout", () => http("POST", "/auth/logout")),

  // ---- account, device binding, PIN, KYC (FE additions, B1) ----
  /** After wallet sign-in: register this device. On another account's device → the security PIN is needed. */
  bindDevice: (user: ApiUser, deviceId: string, deviceKey: Address) =>
    call<LoginResult>(
      "bindDevice",
      () => http("POST", "/auth/device/bind", { deviceId, deviceKey }),
      user,
      deviceId,
      deviceKey,
    ),
  /** New device: the security PIN is required on top of the wallet signature. */
  verifyNewDevice: (address: Address, deviceId: string, pin: string) =>
    call<User>("verifyNewDevice", () => http("POST", "/auth/new-device", { deviceId, pin }), address, deviceId, pin),
  setPin: (address: Address, deviceId: string, pin: string) =>
    call<User>("setPin", () => http("POST", "/auth/pin", { deviceId, pin }), address, deviceId, pin),
  verifyPin: (address: Address, pin: string) =>
    call<{ ok: true }>("verifyPin", () => http("POST", "/auth/pin/verify", { pin }), address, pin),
  getMe: (address: Address) => call<User | null>("getMe", () => http("GET", "/users/me"), address),
  checkDevice: (address: Address, deviceId: string) =>
    call<{ valid: boolean }>("checkDevice", () => http("POST", "/auth/device", { deviceId }), address, deviceId),
  submitKyc: (address: Address, form: FormData) => {
    form.set("address", address); // B1's /kyc/submit reads it from the form
    const plain = {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      pan: String(form.get("pan") ?? ""),
      fileName: (form.get("file") as File | null)?.name ?? "",
    };
    return call<User>("submitKyc", () => http("POST", "/kyc/submit", form), address, plain);
  },
  lookupContact: (phone: string) =>
    call<Contact | null>("lookupContact", () => http("GET", `/users/by-phone/${phone}`), phone),
  listPeople: (address: Address) => call<Contact[]>("listPeople", () => http("GET", `/people?address=${address}`), address),

  // ---- negotiation / agreement (B2) ----
  // Live: B2's POST /drafts takes the counterparty's wallet address (resolved from the looked-up contact).
  createDraft: (me: Address, d: NewDraft, counterparty?: Address) =>
    call<Draft>(
      "createDraft",
      () => {
        if (!counterparty) return Promise.reject(new ApiError(400, "Couldn't find this person's wallet. Try again."));
        return http("POST", "/drafts", { initiator: d.role, counterparty, purpose: d.purpose, price: d.price, terms: d.terms });
      },
      me,
      d,
    ),
  listDrafts: (address: Address) => call<Draft[]>("listDrafts", () => http("GET", `/drafts?address=${address}`), address),
  getDraft: (draftId: string) => call<Draft>("getDraft", () => http("GET", `/drafts/${draftId}`), draftId),
  addTerms: (draftId: string, party: Party, terms: string) =>
    call<Draft>("addTerms", () => http("POST", `/drafts/${draftId}/terms`, { party, terms }), draftId, party, terms),
  getSow: (draftId: string) => call<SowVersion | null>("getSow", () => http("GET", `/drafts/${draftId}/sow`), draftId),
  mergeSow: (draftId: string) => call<SowVersion>("mergeSow", () => http("POST", `/drafts/${draftId}/merge-sow`), draftId),
  proposeConflict: (draftId: string, party: Party, field: Conflict["field"], value: number) =>
    call<SowVersion>(
      "proposeConflict",
      () => http("POST", `/drafts/${draftId}/conflicts`, { party, field, value }),
      draftId,
      party,
      field,
      value,
    ),
  signSow: (draftId: string, party: Party, version: number, signature: Hex, pin: string) =>
    call<SowVersion>(
      "signSow",
      () => http("POST", `/drafts/${draftId}/approve-sow`, { party, version, signature, pin }),
      draftId,
      party,
      version,
      signature,
      pin,
    ),
  cancelDraft: (draftId: string, party: Party, reason: string) =>
    call<Draft>("cancelDraft", () => http("POST", `/drafts/${draftId}/cancel`, { party, reason }), draftId, party, reason),
  redoTerms: (draftId: string, party: Party, terms: string) =>
    call<Draft>("redoTerms", () => http("POST", `/drafts/${draftId}/redo-terms`, { party, terms }), draftId, party, terms),

  // ---- deals (B1) ----
  listDeals: (address: Address) => call<Deal[]>("listDeals", () => http("GET", `/deals?address=${address}`), address),
  getDeal: (id: string) => call<Deal>("getDeal", () => http("GET", `/deals/${id}`), id),
  getAgreement: (id: string) => call<SowVersion | null>("getAgreement", () => http("GET", `/deals/${id}/agreement`), id),
  markDelivered: (id: string, note: string) =>
    call<Deal>(
      "markDelivered",
      async () => {
        const { hash } = await http<{ hash: Hex }>("POST", `/deals/${id}/delivery`, { note });
        await escrow("markDelivered", [dealId(id), hash]);
        return http<Deal>("GET", `/deals/${id}`);
      },
      id,
      note,
    ),
  /** The PIN confirms the buyer is present; the buyer's wallet then signs release(). */
  release: (id: string, pin: string) =>
    call<Deal>(
      "release",
      async () => {
        await http("POST", "/auth/pin/verify", { pin });
        await escrow("release", [dealId(id)]);
        return http<Deal>("GET", `/deals/${id}`);
      },
      id,
      pin,
    ),

  // ---- payments (PG) ----
  onrampSession: (id: string) => call<OnrampSession>("onrampSession", () => http("POST", `/onramp/${id}/session`), id),
  /** `method` is display-only on the backend: it's stored on the payment and shown in history. */
  onrampConfirm: (id: string, method: PayMethod) =>
    call<OnrampConfirm>("onrampConfirm", () => http("POST", `/onramp/${id}/confirm`, { method }), id, method),

  // ---- complaints / disputes (B1 + B2) ----
  raiseComplaint: (id: string, party: Party, form: FormData, files: File[]) => {
    const plain = {
      text: String(form.get("text") ?? ""),
      deliverableIds: form.getAll("deliverables").map(String),
      // TODO(storage): upload the files and keep their URLs; only metadata is sent for now.
      attachments: fileMeta(files),
    };
    return call<Complaint>(
      "raiseComplaint",
      async () => {
        const { hash } = await http<{ hash: Hex }>("POST", `/deals/${id}/evidence`, form);
        await escrow("raiseDispute", [dealId(id), hash]);
        // Ask the AI agent to score the dispute (it proposes a split on-chain); the page polls the resolution.
        http("POST", `/deals/${id}/resolve`, { complaintText: plain.text }).catch(() => undefined);
        return (await http<Complaint | null>("GET", `/deals/${id}/complaint`))!;
      },
      id,
      party,
      plain,
    );
  },
  getComplaint: (id: string) => call<Complaint | null>("getComplaint", () => http("GET", `/deals/${id}/complaint`), id),
  getResolution: (id: string) => call<Resolution>("getResolution", () => http("GET", `/deals/${id}/resolution`), id),
  acceptResolution: (id: string, party: Party) =>
    call<Deal>(
      "acceptResolution",
      async () => {
        await escrow("acceptResolution", [dealId(id)]);
        return http<Deal>("GET", `/deals/${id}`);
      },
      id,
      party,
    ),
  escalate: (id: string) =>
    call<Deal>(
      "escalate",
      async () => {
        await escrow("escalate", [dealId(id)]);
        return http<Deal>("GET", `/deals/${id}`);
      },
      id,
    ),

  // ---- arbitrator (B1) ----
  listCases: () => call<Deal[]>("listCases", () => http("GET", "/arbitrator/cases")),
  arbitrate: (id: string, buyerBps: number, note: string) =>
    call<Deal>("arbitrate", () => http("POST", `/arbitrator/deals/${id}/rule`, { buyerBps, note }), id, buyerBps, note),
};
