// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/pursuitPromotion/types.ts
//  Market Intelligence → Pursuit promotion — shared contract types.
//
//  One canonical vocabulary shared by the service, the API route and the UI so
//  error codes never drift between layers.
// ──────────────────────────────────────────────────────────────────────────────

/** The two market-side surfaces an operator can promote from. */
export const PROMOTION_SOURCE_KINDS = ["LEAD", "PROJECT"] as const;
export type PromotionSourceKind = (typeof PROMOTION_SOURCE_KINDS)[number];

export function isPromotionSourceKind(v: unknown): v is PromotionSourceKind {
  return typeof v === "string" && (PROMOTION_SOURCE_KINDS as readonly string[]).includes(v);
}

/**
 * Stable machine-readable failure codes. The UI switches on these; the strings
 * are part of the API contract and must not be reworded casually.
 */
export type PromotionErrorCode =
  | "unauthorized"        // no session
  | "forbidden"           // authenticated but wrong role for the pursuit phase
  | "invalid_source_kind" // sourceKind not LEAD | PROJECT
  | "invalid_source_id"   // missing / non-string / empty id
  | "not_found"           // no such source row (also used for out-of-scope reads)
  | "ineligible_status"   // source exists but its status forbids promotion
  | "already_promoted"    // promoted, and the caller may NOT see the existing bid
  | "internal_error";

export type PromotionActor = {
  id: string;
  email?: string | null;
  role: string;
};

/** Fields a promotion will write onto the new draft Bid. Allowlist — never a spread. */
export type PursuitDraftFields = {
  projectName: string;
  location: string | null;
  buildingType: string | null;
  approxSqft: number | null;
};

/** Non-Bid public-source context shown in the preview and recorded in audit. */
export type PromotionSourceContext = {
  sourceKind: PromotionSourceKind;
  sourceId: string;
  sourceTitle: string;
  /** Public source URL when the market row carries one. */
  sourceUrl: string | null;
  /** MarketSourceDoc id when the row was machine-detected from a document. */
  sourceDocId: string | null;
  /** Public estimated value. Carried for operator context only — Bid has no
   *  column for it today (see PROVENANCE_FUTURE_SCHEMA in index.ts). */
  estimatedValue: number | null;
  jurisdiction: string | null;
};

export type PromotionPreview = {
  eligible: boolean;
  /** Present when eligible === false. */
  reason: PromotionErrorCode | null;
  /** Set when the source has already been promoted AND the caller may see it. */
  existingBidId: number | null;
  /** True when already promoted but the existing pursuit is out of the caller's scope. */
  promotedOutOfScope: boolean;
  draft: PursuitDraftFields;
  source: PromotionSourceContext;
  /** Public-source values with no Bid column today — displayed, not written. */
  notCarried: { field: string; value: string }[];
};

export type PromotionSuccess = {
  ok: true;
  bidId: number;
  /** true when this call found an existing promotion instead of creating one. */
  reused: boolean;
  sourceKind: PromotionSourceKind;
  sourceId: string;
};

export type PromotionFailure = {
  ok: false;
  error: PromotionErrorCode;
  message: string;
  /** Only ever set alongside error === "ineligible_status". */
  status?: string;
};

export type PromotionResult = PromotionSuccess | PromotionFailure;

// ── Navigation ────────────────────────────────────────────────────────────────
//
// Both directions of the lifecycle link are derived here so the market page,
// the promote control and the pursuit origin card can never disagree about
// where "go to the other side" points.

/** Pursuit detail route for a bid id. */
export function pursuitHref(bidId: number): string {
  return `/bids/${bidId}`;
}

/** Market-side detail route for a promotion source. */
export function marketSourceHref(kind: PromotionSourceKind, sourceId: string): string {
  return kind === "LEAD"
    ? `/market-intelligence/${sourceId}`
    : `/market-intelligence/projects/${sourceId}`;
}

/** HTTP status for each failure code — single source of truth for the route. */
export const PROMOTION_ERROR_HTTP_STATUS: Record<PromotionErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  invalid_source_kind: 400,
  invalid_source_id: 400,
  not_found: 404,
  ineligible_status: 409,
  already_promoted: 409,
  internal_error: 500,
};
