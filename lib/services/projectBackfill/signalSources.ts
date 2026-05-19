// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectBackfill/signalSources.ts
//  Phase MI-6 PR2 — Source-table → SignalInput converters.
//
//  Each function is pure: takes a single row's relevant fields, returns a
//  normalized SignalInput the aggregator can score. Real DB rows come in
//  shaped by execute.ts's findMany() calls; these functions take the
//  picked fields so unit tests don't need Prisma.
// ──────────────────────────────────────────────────────────────────────────────

import type {
  ProjectEntityRole,
  SignalInput,
} from "@/lib/services/projectAggregation";

// ── RelationshipEdge → SignalInput ────────────────────────────────────────────

export interface RelationshipEdgeRow {
  id: string;
  fromType: string;
  fromName: string;
  fromEntityId: string | null;
  toType: string;
  toName: string;
  toEntityId: string | null;
  relationshipType: string;
  projectName: string | null;
  projectYear: number | null;
  location: string | null;
  source: string | null;
  createdAt: Date;
}

const PARCEL_NUM_RE = /\b(\d{10,16})\b/g;
const ADDRESS_RE = /\b\d{1,6}\s+[A-Z][a-zA-Z0-9.'\- ]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Drive|Dr|Lane|Ln|Way|Court|Ct|Highway|Hwy|Place|Pl)\b/i;

function parseLocationParcels(location: string | null): string[] {
  if (!location) return [];
  const out = new Set<string>();
  for (const m of location.matchAll(PARCEL_NUM_RE)) out.add(m[1]);
  return [...out];
}

function inferProjectOccurredAt(row: RelationshipEdgeRow): Date {
  if (row.projectYear) {
    // Mid-year placeholder when only year is known
    return new Date(Date.UTC(row.projectYear, 5, 15));
  }
  return row.createdAt;
}

function normalizeEdgeRole(rawType: string): ProjectEntityRole {
  const k = rawType.toUpperCase().trim();
  if (k === "DEVELOPER") return "DEVELOPER";
  if (k === "OWNER") return "OWNER";
  if (k === "GC") return "GC";
  if (k === "ARCHITECT") return "ARCHITECT";
  if (k === "ENGINEER") return "ENGINEER";
  if (k === "BROKER") return "BROKER";
  if (k === "TENANT") return "TENANT";
  if (k === "LENDER") return "LENDER";
  if (k === "MUNICIPALITY") return "MUNICIPALITY";
  if (k === "AGENCY") return "AGENCY";
  return "OTHER";
}

export function relationshipEdgeToSignalInput(row: RelationshipEdgeRow): SignalInput {
  const parcelIds = parseLocationParcels(row.location);
  const addressMatch = row.location?.match(ADDRESS_RE);
  const entityIds: SignalInput["entityIds"] = [];
  if (row.fromEntityId) {
    entityIds.push({ entityId: row.fromEntityId, role: normalizeEdgeRole(row.fromType) });
  }
  if (row.toEntityId) {
    entityIds.push({ entityId: row.toEntityId, role: normalizeEdgeRole(row.toType) });
  }
  return {
    kind: "RELATIONSHIP_EDGE",
    sourceId: row.id,
    title: row.projectName,
    occurredAt: inferProjectOccurredAt(row),
    jurisdiction: row.location ?? null,
    parcelIds,
    entityIds,
    address: addressMatch ? addressMatch[0] : null,
    tags: row.relationshipType ? [row.relationshipType.toLowerCase()] : [],
  };
}

// ── MarketLead → SignalInput ──────────────────────────────────────────────────

export interface MarketLeadRow {
  id: string;
  title: string;
  leadType: string;
  source: string | null;
  status: string;
  confidence: string;
  location: string | null;
  jurisdiction: string | null;
  projectType: string | null;
  estimatedValue: number | null;
  detectedAt: Date;
}

export function marketLeadToSignalInput(row: MarketLeadRow): SignalInput {
  const tags: string[] = [];
  if (row.projectType) tags.push(row.projectType.toLowerCase());
  if (row.leadType) tags.push(row.leadType.toLowerCase());
  return {
    kind: "MARKET_LEAD",
    sourceId: row.id,
    title: row.title,
    occurredAt: row.detectedAt,
    jurisdiction: row.jurisdiction,
    parcelIds: parseLocationParcels(row.location),
    entityIds: [],
    address: row.location ?? null,
    tags,
  };
}

// ── MarketSignal → SignalInput ───────────────────────────────────────────────

export interface MarketSignalRow {
  id: string;
  headline: string;
  signalType: string;
  signalSubtype: string | null;
  sourceDate: Date | null;
  metadata: string | null;        // JSON
  createdAt: Date;
  // Joined for jurisdiction inference (optional)
  leadJurisdiction?: string | null;
  sourceDocJurisdiction?: string | null;
}

interface MarketSignalMetadata {
  parcelId?: string;
  parcel_id?: string;
  parcelIds?: string[];
  address?: string;
  jurisdiction?: string;
  zoning?: string;
  // Free-form — we tolerate anything else
  [key: string]: unknown;
}

function parseSignalMetadata(s: string | null): MarketSignalMetadata {
  if (!s) return {};
  try {
    return JSON.parse(s) as MarketSignalMetadata;
  } catch {
    return {};
  }
}

const HEADLINE_TAG_PATTERNS: Array<[RegExp, string]> = [
  [/\brezoning\b/i, "rezoning"],
  [/\bsup\b|\bcup\b/i, "sup_cup"],
  [/\bplat\b/i, "plat"],
  [/\bvariance\b/i, "variance"],
  [/\bsite plan\b/i, "site_plan"],
  [/\bcontinued\b|\btabled\b/i, "continued"],
  [/\bbuilding permit\b/i, "building_permit"],
  [/\bwater main\b/i, "water main"],
  [/\bsewer\b|\bsanitary\b/i, "sewer main"],
  [/\blift station\b/i, "lift station"],
  [/\bgrading\b/i, "grading"],
  [/\butility extension\b/i, "utility extension"],
  [/\bdistribution\b|\bwarehouse\b|\blogistics\b|\bfulfillment\b/i, "distribution"],
  [/\bmanufacturing\b/i, "manufacturing"],
  [/\bshell\b/i, "shell"],
  [/\bm-?[12]\b/i, "m-1"],
  [/\bc-?[12]\b/i, "c-1"],
  [/\bpud\b/i, "pud"],
  [/\bindustrial\b/i, "industrial"],
  [/\bcommercial\b/i, "commercial"],
  [/\bmixed[-\s]use\b/i, "mixed-use"],
];

function extractTagsFromHeadline(headline: string): string[] {
  const out = new Set<string>();
  for (const [re, tag] of HEADLINE_TAG_PATTERNS) {
    if (re.test(headline)) out.add(tag);
  }
  return [...out];
}

export function marketSignalToSignalInput(row: MarketSignalRow): SignalInput {
  const meta = parseSignalMetadata(row.metadata);
  const parcelIds = new Set<string>();
  if (typeof meta.parcelId === "string") parcelIds.add(meta.parcelId);
  if (typeof meta.parcel_id === "string") parcelIds.add(meta.parcel_id);
  if (Array.isArray(meta.parcelIds)) {
    for (const p of meta.parcelIds) if (typeof p === "string") parcelIds.add(p);
  }
  for (const p of parseLocationParcels(typeof meta.address === "string" ? meta.address : null)) {
    parcelIds.add(p);
  }

  const tags: string[] = [];
  if (row.signalType) tags.push(row.signalType.toLowerCase());
  if (row.signalSubtype) tags.push(row.signalSubtype.toLowerCase());
  if (typeof meta.zoning === "string") tags.push(meta.zoning.toLowerCase());
  for (const t of extractTagsFromHeadline(row.headline)) tags.push(t);

  const jurisdiction =
    (typeof meta.jurisdiction === "string" ? meta.jurisdiction : null) ??
    row.leadJurisdiction ??
    row.sourceDocJurisdiction ??
    null;

  return {
    kind: "MARKET_SIGNAL",
    sourceId: row.id,
    title: row.headline,
    occurredAt: row.sourceDate ?? row.createdAt,
    jurisdiction,
    parcelIds: [...parcelIds],
    entityIds: [], // future MI-7 ingestion can enrich; MI-6 PR2 leaves empty
    address: typeof meta.address === "string" ? meta.address : null,
    tags,
  };
}
