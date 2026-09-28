// Typed API client. Every endpoint is mocked until it is listed in NEXT_PUBLIC_LIVE_ENDPOINTS
// (comma-separated keys below, or "*"), so we can switch to the live backend one endpoint at a time.
import type { Address, Hex } from "viem";
import * as mock from "./mocks";
import type {
  ApproveSowResult,
  Complaint,
  Deal,
  Draft,
  NewDraft,
  OnrampConfirm,
  OnrampSession,
  PaymentInfo,
  Resolution,
  Sow,
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
  // ---- auth / KYC (PG, B1) ----
  // Phone + OTP via SARAL; the account is bound to one device (deviceId), like UPI.
  requestOtp: (phone: string) =>
    call<{ sent: true }>("requestOtp", () => http("POST", "/auth/otp", { phone }), () => mock.requestOtp(phone)),
  verifyOtp: (phone: string, otp: string, deviceId: string) =>
    call<User>(
      "verifyOtp",
      () => http("POST", "/auth/saral", { phone, otp, deviceId }),
      () => mock.verifyOtp(phone, otp, deviceId),
    ),
  checkDevice: (phone: string, deviceId: string) =>
    call<{ valid: boolean }>(
      "checkDevice",
      () => http("POST", "/auth/device", { phone, deviceId }),
      () => mock.checkDevice(phone, deviceId),
    ),
  submitKyc: (form: FormData) =>
    call<Pick<User, "kycLevel" | "name">>("submitKyc", () => http("POST", "/kyc/submit", form), () => mock.submitKyc(form)),

  // ---- negotiation / SOW (B2) ----
  createDraft: (d: NewDraft) =>
    call<Draft>("createDraft", () => http("POST", "/deals", d), () => mock.createDraft(d)),
  listDrafts: (address: Address) =>
    call<Draft[]>("listDrafts", () => http("GET", `/drafts?address=${address}`), () => mock.listDrafts(address)),
  getDraft: (draftId: string) =>
    call<Draft>("getDraft", () => http("GET", `/drafts/${draftId}`), () => mock.getDraft(draftId)),
  getSow: (draftId: string) =>
    call<SowVersion | null>("getSow", () => http("GET", `/deals/${draftId}/sow`), () => mock.getSow(draftId)),
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
  // TODO(FE): replace with proposeDeal / acceptDeal signed through SARAL once the ABI lands.
  startDeal: (draftId: string) =>
    call<{ dealId: string }>("startDeal", () => http("POST", `/deals/${draftId}/start`), () => mock.startDeal(draftId)),

  // ---- deals (B1) ----
  listDeals: (address: Address) =>
    call<Deal[]>("listDeals", () => http("GET", `/deals?address=${address}`), () => mock.listDeals(address)),
  getDeal: (id: string) => call<Deal>("getDeal", () => http("GET", `/deals/${id}`), () => mock.getDeal(id)),
  getDealSow: (id: string) => call<Sow>("getDealSow", () => http("GET", `/deals/${id}/sow`), () => mock.getDealSow(id)),
  // TODO(FE): release / acceptResolution / escalate become contract calls signed through SARAL.
  release: (id: string) => call<Deal>("release", () => http("POST", `/deals/${id}/release`), () => mock.release(id)),
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

  // ---- complaints / disputes (B1 + B2) ----
  raiseComplaint: (id: string, form: FormData) =>
    call<Complaint>("raiseComplaint", () => http("POST", `/deals/${id}/evidence`, form), () => mock.raiseComplaint(id, form)),
  getComplaint: (id: string) =>
    call<Complaint | null>("getComplaint", () => http("GET", `/deals/${id}/complaint`), () => mock.getComplaint(id)),
  acceptResolution: (id: string) =>
    call<Deal>("acceptResolution", () => http("POST", `/deals/${id}/accept`), () => mock.acceptResolution(id)),
  escalate: (id: string) => call<Deal>("escalate", () => http("POST", `/deals/${id}/escalate`), () => mock.escalate(id)),
  resolve: (id: string) =>
    call<Resolution>("resolve", () => http("POST", `/deals/${id}/resolve`), () => mock.resolve(id)),
  getResolution: (id: string) =>
    call<Resolution>("getResolution", () => http("GET", `/deals/${id}/resolution`), () => mock.getResolution(id)),
  verify: (id: string) =>
    call<VerifyResult>("verify", () => http("GET", `/deals/${id}/verify`), () => mock.verify(id)),
};
