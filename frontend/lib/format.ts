import { formatUnits } from "viem";
import { USD_DECIMALS } from "./contracts";
import type { Deal, DealStatus } from "./types";

// Display rate until PG's on-ramp quote endpoint is live. Users only ever see rupees.
export const INR_PER_USD = 84;

/** Base units (6 decimals) → human string, e.g. 100000000n → "100". */
export const fmtUsd = (x: bigint | string) => formatUnits(BigInt(x), USD_DECIMALS);

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });
/** Base units (6 decimals) → "₹8,400". */
export const fmtInr = (x: bigint | string) => inr.format(Math.round((Number(BigInt(x)) / 1e6) * INR_PER_USD * 100) / 100);

/** basis points → "35%" / "35.5%". */
export const fmtBps = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;

export const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
export const fmtDateTime = (unix: number) =>
  new Date(unix * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
export const fmtMonth = (unix: number) => new Date(unix * 1000).toLocaleDateString("en-IN", { month: "long", year: "numeric" });

/** User-facing transaction ID derived from the on-chain deal id. */
export const txnId = (dealId: string) => `SKS${dealId.padStart(9, "0")}`;

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export const maskPhone = (p: string) => (p.length >= 4 ? `+91 ••••• ${p.slice(-5)}` : p);

// ---- deal lifecycle in plain words ----
export const SETTLED: DealStatus[] = ["Released", "Refunded", "Resolved", "Split", "Cancelled"];
export const COMPLAINT_OPEN: DealStatus[] = ["Disputed", "ResolutionProposed", "Escalated"];
/** raiseDispute is allowed while funds are held and the review window is open (DealEscrow.sol). */
export const CAN_COMPLAIN: DealStatus[] = ["Funded", "Delivered"];

export const isSettled = (d: Deal) => SETTLED.includes(d.status);
export const initiatedAt = (d: Deal) => (d.events.find((e) => e.name === "DealProposed") ?? d.events[0])?.timestamp ?? 0;
export const releasedAt = (d: Deal) =>
  [...d.events].reverse().find((e) => ["Settled", "Released", "Refunded", "Arbitrated"].includes(e.name))?.timestamp;

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";
export const statusText: Record<DealStatus, { label: string; tone: Tone }> = {
  Proposed: { label: "Waiting for payee", tone: "neutral" },
  Accepted: { label: "Payment pending", tone: "warning" },
  Funded: { label: "Paid · held safely", tone: "accent" },
  Delivered: { label: "Work delivered · review it", tone: "info" },
  Disputed: { label: "Complaint under review", tone: "warning" },
  ResolutionProposed: { label: "Resolution ready", tone: "warning" },
  Escalated: { label: "With arbitrator", tone: "danger" },
  Released: { label: "Completed", tone: "success" },
  Refunded: { label: "Refunded", tone: "success" },
  Resolved: { label: "Settled after complaint", tone: "success" },
  Split: { label: "Settled after complaint", tone: "success" },
  Cancelled: { label: "Cancelled", tone: "neutral" },
};
