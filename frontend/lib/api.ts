// Typed API client. Every endpoint is mocked until it is listed in NEXT_PUBLIC_LIVE_ENDPOINTS
// (comma-separated keys below, or "*"), so we can switch to the live backend one endpoint at a time.
import type { Address, Hex } from "viem";
import * as mock from "./mocks";
import type {
  ApproveSowResult,
  Deal,
  Draft,
  OnrampConfirm,
  OnrampSession,
  PaymentInfo,
  Resolution,
  SowVersion,
  User,
  VerifyResult,
} from "./types";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000").replace(/\/$/, "");
const LIVE = new Set((process.env.NEXT_PUBLIC_LIVE_ENDPOINTS ?? "").split(",").map((s) => s.trim()));
const isLive = (key: string) => LIVE.has("*") || LIVE.has(key);

export class ApiError extends Error {
  constructor(public status: number, message: string) {
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

const call = <T>(key: string, live: () => Promise<T>, fake: () => Promise<T>) => (isLive(key) ? live() : fake());

export const api = {
  // ---- auth / KYC (B1, PG) ----
  login: (address: Address) =>
    call<User>("login", () => http("POST", "/auth/wallet", { address }), () => mock.login(address)),
  getUser: (address: Address) =>
    call<User>("getUser", () => http("GET", `/users/${address}`), () => mock.getUser(address)),
  submitKyc: (form: FormData) =>
    call<User>("submitKyc", () => http("POST", "/kyc/submit", form), () => mock.submitKyc(form)),

  // ---- negotiation / SOW (B2) ----
  createDraft: (d: { seller: string; purpose: string; price: string; buyerConstraints: string }) =>
    call<Draft>("createDraft", () => http("POST", "/deals", d), () => mock.createDraft(d)),
  getDraft: (draftId: string) =>
    call<Draft>("getDraft", () => http("GET", `/drafts/${draftId}`), () => mock.getDraft(draftId)),
  sellerInput: (draftId: string, sellerPoints: string) =>
    call<Draft>(
      "sellerInput",
      () => http("POST", `/deals/${draftId}/seller-input`, { sellerPoints }),
      () => mock.sellerInput(draftId, sellerPoints),
    ),
  mergeSow: (draftId: string) =>
    call<SowVersion>("mergeSow", () => http("POST", `/deals/${draftId}/merge-sow`), () => mock.mergeSow(draftId)),
  approveSow: (draftId: string, party: "buyer" | "seller", version: number) =>
    call<ApproveSowResult>(
      "approveSow",
      () => http("POST", `/deals/${draftId}/approve-sow`, { party, version }),
      () => mock.approveSow(draftId, party, version),
    ),

  // ---- deals (B1) ----
  listDeals: (address: Address) =>
    call<Deal[]>("listDeals", () => http("GET", `/deals?address=${address}`), () => mock.listDeals(address)),
  getDeal: (id: string) => call<Deal>("getDeal", () => http("GET", `/deals/${id}`), () => mock.getDeal(id)),
  uploadDelivery: (id: string, form: FormData) =>
    call<{ hash: Hex }>("uploadDelivery", () => http("POST", `/deals/${id}/delivery`, form), mock.fileHash),
  uploadEvidence: (id: string, form: FormData) =>
    call<{ hash: Hex }>("uploadEvidence", () => http("POST", `/deals/${id}/evidence`, form), mock.fileHash),

  // ---- payments (PG) ----
  onrampSession: (id: string) =>
    call<OnrampSession>("onrampSession", () => http("POST", `/onramp/${id}/session`), () => mock.onrampSession(id)),
  onrampConfirm: (id: string) =>
    call<OnrampConfirm>("onrampConfirm", () => http("POST", `/onramp/${id}/confirm`), () => mock.onrampConfirm(id)),
  getPayment: (id: string) =>
    call<PaymentInfo>("getPayment", () => http("GET", `/deals/${id}/payment`), () => mock.getPayment(id)),

  // ---- disputes (B1 + B2) ----
  resolve: (id: string) =>
    call<Resolution>("resolve", () => http("POST", `/deals/${id}/resolve`), () => mock.resolve(id)),
  verify: (id: string) =>
    call<VerifyResult>("verify", () => http("GET", `/deals/${id}/verify`), () => mock.verify(id)),
  arbitrate: (id: string, buyerBps: number, adminToken: string) =>
    call<{ txHash: Hex }>(
      "arbitrate",
      () => http("POST", `/arbitrator/deals/${id}/rule`, { buyerBps, adminToken }),
      () => mock.arbitrate(id, buyerBps),
    ),
};
