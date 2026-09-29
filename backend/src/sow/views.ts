// API response shapes for the FE (frontend/lib/types.ts), built from the stored rows. Supersets: FE's fields plus ours.
import type { Sow } from "@kernel-exploits/shared";
import type { Conflict, Draft, DraftStatus, Party, Signature, StoredSowVersion } from "./store";

/** FE-facing status: awaiting_other → ready_to_merge → merged (a SOW exists) → signed (both approved one version). */
export type PublicStatus = "awaiting_other" | "ready_to_merge" | "merged" | "signed";

export function publicStatus(stage: DraftStatus): PublicStatus {
  switch (stage) {
    case "awaiting_other":
    case "awaiting_seller":
      return "awaiting_other";
    case "ready_to_merge":
      return "ready_to_merge";
    case "sow_proposed":
      return "merged";
    case "approved":
    case "linked":
      return "signed";
  }
}

export type DraftView = {
  id: string;
  initiator: Party;
  buyer: string;
  seller: string;
  buyerName: string | null; // resolved by PG/FE; always null from B2
  sellerName: string | null;
  purpose: string;
  price: string; // = amount (base units)
  amount: string;
  buyerTerms?: string; // = buyerConstraints
  sellerTerms?: string; // = sellerPoints
  buyerConstraints?: string;
  sellerPoints?: string;
  deliveryDeadline: number;
  reviewWindowSecs: number;
  status: PublicStatus;
  stage: DraftStatus; // internal lifecycle, e.g. "linked"
  latestSowVersion?: number;
  dealId?: string;
  linkTxHash?: string;
  createdAt: number;
  updatedAt: number;
};

export function draftView(d: Draft): DraftView {
  return {
    id: d.id,
    initiator: d.initiator,
    buyer: d.buyer,
    seller: d.seller,
    buyerName: null,
    sellerName: null,
    purpose: d.purpose,
    price: d.amount,
    amount: d.amount,
    ...(d.buyerConstraints !== undefined && { buyerTerms: d.buyerConstraints, buyerConstraints: d.buyerConstraints }),
    ...(d.sellerPoints !== undefined && { sellerTerms: d.sellerPoints, sellerPoints: d.sellerPoints }),
    deliveryDeadline: d.deliveryDeadline,
    reviewWindowSecs: d.reviewWindowSecs,
    status: publicStatus(d.status),
    stage: d.status,
    ...(d.latestSowVersion !== undefined && { latestSowVersion: d.latestSowVersion }),
    ...(d.dealId !== undefined && { dealId: String(d.dealId) }),
    ...(d.linkTxHash !== undefined && { linkTxHash: d.linkTxHash }),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export type SowVersion = {
  draftId: string;
  version: number;
  sow: Sow;
  sowHash: string;
  conflicts: Conflict[]; // structured and resolvable; approve-sow is blocked while any is present
  signatures: Signature[];
  conflictNotes: string[]; // free-text agent conflicts + "[server] …" notes
  approvals: { buyer: boolean; seller: boolean };
  createdAt: number;
};

export function sowVersionView(v: StoredSowVersion): SowVersion {
  return {
    draftId: v.draftId,
    version: v.version,
    sow: JSON.parse(v.sowJson) as Sow,
    sowHash: v.sowHash,
    conflicts: v.conflicts,
    signatures: v.signatures,
    conflictNotes: v.conflictNotes,
    approvals: { buyer: v.buyerApproved, seller: v.sellerApproved },
    createdAt: v.createdAt,
  };
}
