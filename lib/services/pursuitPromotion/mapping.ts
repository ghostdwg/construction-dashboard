// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/pursuitPromotion/mapping.ts
//  Market → Pursuit safe-field mapping.
//
//  CONFIDENTIALITY CONTRACT
//  ────────────────────────
//  These mappers are the ONLY place market data becomes pursuit data. They are
//  written as explicit allowlists — never `{...source}` — so a new column on
//  MarketLead / Project can never silently flow into a Bid.
//
//  Deliberately NOT carried:
//    · aiSummary / aiInsights / aiScore / emergenceProbability / heuristics*
//      — AI-derived transient judgement, not public source fact. A pursuit that
//        quotes a model's guess as if it were intake data is a false record.
//    · rawText — unbounded scraped document text; belongs to the MarketSourceDoc
//      it came from, reachable via the provenance link instead of copied.
//    · notes / confidence / reviewStatus / lifecycleState — market-desk internal
//      workflow state with no meaning on the bid side.
//
//  The reverse direction (pricingData, rawPriceText, subcontractor names,
//  company names, isPreferred) has no path here at all: nothing in this module
//  reads bid-side data, so no confidential pursuit field can reach the Market
//  Intelligence wing. See the assertions in __tests__/mapping.test.ts.
// ──────────────────────────────────────────────────────────────────────────────

import type {
  PromotionSourceContext,
  PursuitDraftFields,
} from "./types";

/** Exact set of Bid columns a promotion may write. Asserted in tests. */
export const PROMOTION_WRITABLE_BID_FIELDS = [
  "projectName",
  "location",
  "buildingType",
  "approxSqft",
] as const;

/**
 * Source-side property names that must NEVER appear in a mapper's output or in
 * an audit payload. Asserted in tests against both mappers.
 */
export const PROMOTION_FORBIDDEN_SOURCE_FIELDS = [
  "aiSummary",
  "aiInsights",
  "aiScore",
  "rawText",
  "notes",
  "emergenceProbability",
  "heuristicsJson",
  "heuristicsScore",
  "heuristicsClassification",
  "pricingData",
  "rawPriceText",
  "isPreferred",
] as const;

const UNTITLED = "Untitled pursuit";

function clean(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function title(v: string | null | undefined): string {
  return clean(v) ?? UNTITLED;
}

function positiveInt(v: number | null | undefined): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  return n > 0 ? n : null;
}

function finiteNumber(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// ── MarketLead ────────────────────────────────────────────────────────────────

/** Narrow read shape — intentionally excludes every field listed as forbidden. */
export type LeadMappingSource = {
  id: string;
  title: string;
  location: string | null;
  jurisdiction: string | null;
  projectType: string | null;
  estimatedValue: number | null;
  sourceUrl: string | null;
  sourceDocId: string | null;
};

export function mapLeadToDraft(lead: LeadMappingSource): PursuitDraftFields {
  return {
    projectName: title(lead.title),
    // A lead's jurisdiction is the coarser public locator; use it only when the
    // specific location is absent so the pursuit is never left placeless.
    location: clean(lead.location) ?? clean(lead.jurisdiction),
    // MarketLead.projectType is a building use ("medical office"), NOT the
    // Bid.projectType enum (PUBLIC | PRIVATE | NEGOTIATED). It maps to
    // Bid.buildingType. Bid.projectType is left at its schema default so an
    // operator makes that procurement call explicitly during intake.
    buildingType: clean(lead.projectType),
    approxSqft: null,
  };
}

export function leadSourceContext(lead: LeadMappingSource): PromotionSourceContext {
  return {
    sourceKind: "LEAD",
    sourceId: lead.id,
    sourceTitle: title(lead.title),
    sourceUrl: clean(lead.sourceUrl),
    sourceDocId: clean(lead.sourceDocId),
    estimatedValue: finiteNumber(lead.estimatedValue),
    jurisdiction: clean(lead.jurisdiction),
  };
}

// ── Market Project aggregate ──────────────────────────────────────────────────

export type ProjectMappingSource = {
  id: string;
  workingTitle: string;
  jurisdiction: string | null;
  projectType: string | null;
  estimatedValue: number | null;
  estimatedSqft: number | null;
  source: string | null;
};

export function mapProjectToDraft(project: ProjectMappingSource): PursuitDraftFields {
  return {
    projectName: title(project.workingTitle),
    // A Project aggregate has no street location — jurisdiction is the only
    // public locator it carries.
    location: clean(project.jurisdiction),
    buildingType: clean(project.projectType),
    approxSqft: positiveInt(project.estimatedSqft),
  };
}

export function projectSourceContext(
  project: ProjectMappingSource
): PromotionSourceContext {
  return {
    sourceKind: "PROJECT",
    sourceId: project.id,
    sourceTitle: title(project.workingTitle),
    // Project.source is a provenance label ("aggregated"), not a URL.
    sourceUrl: null,
    sourceDocId: null,
    estimatedValue: finiteNumber(project.estimatedValue),
    jurisdiction: clean(project.jurisdiction),
  };
}

// ── Preview-only surface ──────────────────────────────────────────────────────

/**
 * Public-source values the operator should see before confirming but which
 * have no Bid column today. Shown in the preview as "stays on the source" so
 * the promotion never silently appears to have dropped them.
 */
export function notCarriedFields(
  source: PromotionSourceContext
): { field: string; value: string }[] {
  const out: { field: string; value: string }[] = [];
  if (source.estimatedValue != null) {
    out.push({
      field: "Estimated value",
      value: `$${Math.round(source.estimatedValue).toLocaleString()}`,
    });
  }
  if (source.sourceUrl) out.push({ field: "Source URL", value: source.sourceUrl });
  return out;
}
