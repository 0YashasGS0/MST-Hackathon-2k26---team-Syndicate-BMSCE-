// Typed API client. Every endpoint goes to the shared fake backend (/api/mock → lib/mocks.ts) until it is
// listed in NEXT_PUBLIC_LIVE_ENDPOINTS (comma-separated keys below, or "*"), so we can switch to the live
// backend one endpoint at a time.
import type { Address, Hex } from "viem";
import type {
  Attachment,
  Complaint,
  Conflict,
  Contact,
  Deal,
  Draft,
  LoginResult,
  NewDraft,
  OnrampSession,
  Party,
  PayMethod,
  Resolution,
  SowVersion,
  User,
} from "./types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
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
  const init: RequestInit = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new ApiError(res.status, err.error ?? err.message ?? res.statusText);
  }
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

export const api = {
  // ---- auth / accounts (PG, B1) ----
  requestOtp: (phone: string) => call<{ sent: true }>("requestOtp", () => http("POST", "/auth/otp", { phone }), phone),
  verifyOtp: (phone: string, otp: string, deviceId: string, deviceKey: Address) =>
    call<LoginResult>("verifyOtp", () => http("POST", "/auth/saral", { phone, otp, deviceId, deviceKey }), phone, otp, deviceId, deviceKey),
  /** New device: the security PIN is required on top of the OTP. */
  verifyNewDevice: (phone: string, deviceId: string, pin: string) =>
    call<User>("verifyNewDevice", () => http("POST", "/auth/new-device", { phone, deviceId, pin }), phone, deviceId, pin),
  setPin: (phone: string, deviceId: string, pin: string) =>
    call<User>("setPin", () => http("POST", "/auth/pin", { phone, deviceId, pin }), phone, deviceId, pin),
  verifyPin: (phone: string, pin: string) =>
    call<{ ok: true }>("verifyPin", () => http("POST", "/auth/pin/verify", { phone, pin }), phone, pin),
  getMe: (phone: string) => call<User | null>("getMe", () => http("GET", `/users/me?phone=${phone}`), phone),
  checkDevice: (phone: string, deviceId: string) =>
    call<{ valid: boolean }>("checkDevice", () => http("POST", "/auth/device", { phone, deviceId }), phone, deviceId),
  submitKyc: (phone: string, form: FormData) => {
    const plain = {
      name: String(form.get("name") ?? ""),
      pan: String(form.get("pan") ?? ""),
      fileName: (form.get("file") as File | null)?.name ?? "",
    };
    return call<User>("submitKyc", () => http("POST", "/kyc/submit", form), phone, plain);
  },
  linkWallet: (phone: string, wallet: Address) =>
    call<User>("linkWallet", () => http("POST", "/users/wallet", { phone, wallet }), phone, wallet),
  lookupContact: (phone: string) =>
    call<Contact | null>("lookupContact", () => http("GET", `/users/by-phone/${phone}`), phone),
  listPeople: (address: Address) => call<Contact[]>("listPeople", () => http("GET", `/people?address=${address}`), address),

  // ---- negotiation / agreement (B2) ----
  createDraft: (mePhone: string, d: NewDraft) => call<Draft>("createDraft", () => http("POST", "/deals", d), mePhone, d),
  listDrafts: (address: Address) => call<Draft[]>("listDrafts", () => http("GET", `/drafts?address=${address}`), address),
  getDraft: (draftId: string) => call<Draft>("getDraft", () => http("GET", `/drafts/${draftId}`), draftId),
  addTerms: (draftId: string, party: Party, terms: string) =>
    call<Draft>("addTerms", () => http("POST", `/deals/${draftId}/terms`, { party, terms }), draftId, party, terms),
  getSow: (draftId: string) => call<SowVersion | null>("getSow", () => http("GET", `/deals/${draftId}/sow`), draftId),
  mergeSow: (draftId: string) => call<SowVersion>("mergeSow", () => http("POST", `/deals/${draftId}/merge-sow`), draftId),
  proposeConflict: (draftId: string, party: Party, field: Conflict["field"], value: number) =>
    call<SowVersion>(
      "proposeConflict",
      () => http("POST", `/deals/${draftId}/conflicts`, { party, field, value }),
      draftId,
      party,
      field,
      value,
    ),
  signSow: (draftId: string, party: Party, version: number, signature: Hex, pin: string) =>
    call<SowVersion>(
      "signSow",
      () => http("POST", `/deals/${draftId}/approve-sow`, { party, version, signature, pin }),
      draftId,
      party,
      version,
      signature,
      pin,
    ),

  // ---- deals (B1) ----
  listDeals: (address: Address) => call<Deal[]>("listDeals", () => http("GET", `/deals?address=${address}`), address),
  getDeal: (id: string) => call<Deal>("getDeal", () => http("GET", `/deals/${id}`), id),
  getAgreement: (id: string) => call<SowVersion | null>("getAgreement", () => http("GET", `/deals/${id}/agreement`), id),
  // TODO(FE): markDelivered / release / acceptResolution / escalate become contract calls signed through SARAL.
  markDelivered: (id: string, note: string) =>
    call<Deal>("markDelivered", () => http("POST", `/deals/${id}/delivery`, { note }), id, note),
  release: (id: string, pin: string) => call<Deal>("release", () => http("POST", `/deals/${id}/release`, { pin }), id, pin),

  // ---- payments (PG) ----
  onrampSession: (id: string) => call<OnrampSession>("onrampSession", () => http("POST", `/onramp/${id}/session`), id),
  onrampConfirm: (id: string, method: PayMethod) =>
    call<Deal>("onrampConfirm", () => http("POST", `/onramp/${id}/confirm`, { method }), id, method),

  // ---- complaints / disputes (B1 + B2) ----
  raiseComplaint: (id: string, party: Party, form: FormData, files: File[]) => {
    const plain = {
      text: String(form.get("text") ?? ""),
      deliverableIds: form.getAll("deliverables").map(String),
      // TODO(storage): upload the files and keep their URLs; only metadata is sent for now.
      attachments: fileMeta(files),
    };
    return call<Complaint>("raiseComplaint", () => http("POST", `/deals/${id}/evidence`, form), id, party, plain);
  },
  getComplaint: (id: string) => call<Complaint | null>("getComplaint", () => http("GET", `/deals/${id}/complaint`), id),
  getResolution: (id: string) => call<Resolution>("getResolution", () => http("GET", `/deals/${id}/resolution`), id),
  acceptResolution: (id: string, party: Party) =>
    call<Deal>("acceptResolution", () => http("POST", `/deals/${id}/accept`, { party }), id, party),
  escalate: (id: string) => call<Deal>("escalate", () => http("POST", `/deals/${id}/escalate`), id),

  // ---- arbitrator (B1) ----
  listCases: () => call<Deal[]>("listCases", () => http("GET", "/arbitrator/cases")),
  arbitrate: (id: string, buyerBps: number, note: string) =>
    call<Deal>("arbitrate", () => http("POST", `/arbitrator/deals/${id}/rule`, { buyerBps, note }), id, buyerBps, note),
};
