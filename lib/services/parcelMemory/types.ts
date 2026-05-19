// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/parcelMemory/types.ts
//  Phase MI-7 — Parcel Memory + Spatial Emergence Intelligence types.
//
//  Pseudo-enums are exported as `as const` arrays + derived union types so:
//   - Prisma schema columns can stay TEXT (no migration needed to add values)
//   - app code gets compile-time exhaustiveness
//   - JSON/AI payloads can validate against the array at runtime
// ──────────────────────────────────────────────────────────────────────────────

export const PARCEL_KINDS = [
  "ASSESSOR",     // canonical assessor parcel id (best identity)
  "LEGAL",        // legal description text known
  "ADDRESS_ONLY", // only street address available
  "UTILITY",      // utility-service identifier (e.g. water account parcel)
  "CORRIDOR",     // ROW / corridor / linear infrastructure parcel
  "UNKNOWN",      // freshly created from ambiguous input
] as const;
export type ParcelKind = (typeof PARCEL_KINDS)[number];

export const PARCEL_REVIEW_STATES = [
  "AUTO",            // unmoderated; resolver may touch
  "AUTO_MATCHED",    // resolver attached this row via Pass 1/2/3
  "PENDING_REVIEW",  // Pass 4 — fuzzy match below threshold; needs operator
  "VERIFIED",        // operator-confirmed canonical parcel
  "REJECTED",        // operator rejected; resolver skips on future passes
  "MERGED",          // absorbed into another canonical parcel
] as const;
export type ParcelReviewState = (typeof PARCEL_REVIEW_STATES)[number];

export const PARCEL_CONFIDENCES = ["HIGH", "MEDIUM", "LOW", "VERIFIED"] as const;
export type ParcelConfidence = (typeof PARCEL_CONFIDENCES)[number];

export const PARCEL_ALIAS_KINDS = [
  "LEGAL_DESCRIPTION",
  "ASSESSOR_NAME",
  "ADDRESS",
  "UTILITY_REF",
  "INFORMAL",
  "OTHER",
] as const;
export type ParcelAliasKind = (typeof PARCEL_ALIAS_KINDS)[number];

export const PARCEL_ADJACENCY_KINDS = [
  "SHARED_BOUNDARY",
  "ACROSS_STREET",
  "CORRIDOR",
  "SAME_BLOCK",
  "NEARBY",
  "INFERRED",
] as const;
export type ParcelAdjacencyKind = (typeof PARCEL_ADJACENCY_KINDS)[number];

export const PARCEL_SIGNAL_KINDS = [
  "MARKET_SIGNAL",
  "RELATIONSHIP_EDGE",
  "MARKET_LEAD",
  "SOURCE_DOC",
  "MANUAL",
  "EXTERNAL",
] as const;
export type ParcelSignalKind = (typeof PARCEL_SIGNAL_KINDS)[number];

export const PARCEL_UTILITY_KINDS = [
  "WATER",
  "SEWER",
  "STORM",
  "ELECTRIC",
  "GAS",
  "FIBER",
  "OTHER",
] as const;
export type ParcelUtilityKind = (typeof PARCEL_UTILITY_KINDS)[number];

export const PARCEL_UTILITY_AVAILABILITY = [
  "AVAILABLE",
  "PROPOSED",
  "UNDER_CONSTRUCTION",
  "INSUFFICIENT",
  "UNKNOWN",
] as const;
export type ParcelUtilityAvailability = (typeof PARCEL_UTILITY_AVAILABILITY)[number];

export const PARCEL_ZONING_KINDS = [
  "CURRENT",
  "PROPOSED",
  "OVERLAY",
  "HISTORICAL",
  "SUBJECT_OF_REZONING",
] as const;
export type ParcelZoningKind = (typeof PARCEL_ZONING_KINDS)[number];

export type ParcelResolverPass = 1 | 2 | 3 | 4 | 5;

// Bumps when normalize.ts rules change OR resolver pass behavior changes.
// Backfill (MI-7 PR-2) records this on ProjectParcel.parcelResolverVersion
// so past resolutions can be selectively re-evaluated.
export const PARCEL_RESOLVER_VERSION = "v1" as const;

// Bumps when the pressure heuristic weights or factor definitions change.
// ParcelPressureSnapshot rows record this so re-evaluation is selective.
export const PRESSURE_VERSION = "v1" as const;

// ─── Wire shapes ─────────────────────────────────────────────────────────────

export interface ParcelRecord {
  id: string;
  canonicalRef: string;
  normalizedRef: string;
  parcelKind: string;
  assessorParcelId: string | null;
  legalDescription: string | null;
  primaryAddress: string | null;
  jurisdiction: string | null;
  state: string | null;
  centroidLat: number | null;
  centroidLng: number | null;
  reviewStatus: string;
  confidence: string;
}

export interface ParcelAliasRecord {
  id: string;
  parcelId: string;
  alias: string;
  normalizedAlias: string;
  aliasKind: string;
  confidence: string;
}

export interface ParcelResolverInput {
  /** The raw text we want to resolve. May be a parcel id, address, legal
   *  description, or informal name. */
  rawRef: string;
  /** Optional hint about which kind of identifier rawRef is. */
  kind?: ParcelKind;
  /** Optional jurisdiction hint to narrow candidates. */
  jurisdiction?: string | null;
  /** Optional state hint. */
  state?: string | null;
  /** Source label for audit. */
  source?: string;
}

export interface ParcelResolverMatch {
  parcel: ParcelRecord | null;
  confidence: ParcelConfidence;
  pass: ParcelResolverPass;
  similarityScore: number | null;
  needsReview: boolean;
  reason: string;
  candidates: Array<{
    id: string;
    canonicalRef: string;
    similarityScore: number;
  }>;
}

export interface ParcelResolverAuditEntry {
  inputRef: string;
  normalizedInput: string;
  pass: ParcelResolverPass;
  result: "matched" | "created" | "no_match" | "needs_review";
  parcelId: string | null;
  confidence: ParcelConfidence;
  similarityScore: number | null;
  candidateIds: string[];
  resolverVersion: typeof PARCEL_RESOLVER_VERSION;
  source: string;
  timestamp: string;
}

// ── Pressure model ────────────────────────────────────────────────────────────
//
// Pressure is a 0..1 composite of factors that together describe how much
// market/development force is acting on a parcel right now. Pure function of
// the parcel's own context — no random state.

export interface ParcelPressureInput {
  parcelId: string;
  /** Count of distinct projects currently attached (non-detached). */
  attachedProjectCount: number;
  /** Distinct developer entity ids across attached projects. */
  developerEntityIds: string[];
  /** Distinct broker entity ids across attached projects. */
  brokerEntityIds: string[];
  /** Active rezoning / SUP / variance / plat signals attached in last 365d. */
  recentEntitlementSignals: number;
  /** PROPOSED or UNDER_CONSTRUCTION utility rows currently in effect. */
  activeUtilityExpansions: number;
  /** Continuance count across attached agenda signals. */
  continuanceCount: number;
  /** Count of adjacent parcels with pressureScore ≥ 0.5 in the last snapshot. */
  pressuredNeighborCount: number;
  /** Count of nearby parcels (any adjacency kind) currently linked to a
   *  shell-building pattern (industrial-zoned + utility extension + engineer
   *  without owner). Cheap signal for "speculative cluster". */
  nearbyShellPatternCount: number;
  /** Days since the most recent signal observation on the parcel. Used to
   *  half-life decay older pressure away. */
  daysSinceLastSignal: number;
  /** Cumulative count of ownership transfers observed in the last 5 years. */
  recentOwnershipTransferCount: number;
  /** Whether a known infrastructure-investment signal is present (TIF, bond,
   *  state DOT improvement, etc.). */
  hasInfrastructureInvestment: boolean;
  /** Whether the parcel sits on a known growth corridor (per ParcelAdjacency
   *  with adjacencyKind=CORRIDOR). */
  isOnCorridor: boolean;
}

export interface ParcelPressureFactors {
  developerRecurrence: number;       // 0..1
  brokerRecurrence: number;          // 0..1
  entitlementActivity: number;       // 0..1
  utilityExpansion: number;          // 0..1
  continuancePressure: number;       // 0..1
  neighborPressure: number;          // 0..1
  shellClusterProximity: number;     // 0..1
  ownershipChurn: number;            // 0..1
  infrastructureInvestment: number;  // 0..1
  corridorAdjacency: number;         // 0..1
  recencyMultiplier: number;         // 0..1 — half-life decay
}

export interface ParcelPressureResult {
  parcelId: string;
  pressureScore: number;     // composite 0..1
  factors: ParcelPressureFactors;
  reasonLog: string[];
  pressureVersion: typeof PRESSURE_VERSION;
}

/** Default factor weights — operator-tunable; sum doesn't need to equal 1.
 *  The recencyMultiplier is applied AFTER the weighted sum, not as a weighted
 *  factor itself (it's a multiplicative decay). */
export const PRESSURE_FACTOR_WEIGHTS: Record<
  Exclude<keyof ParcelPressureFactors, "recencyMultiplier">,
  number
> = {
  developerRecurrence: 4,
  brokerRecurrence: 2,
  entitlementActivity: 4,
  utilityExpansion: 3,
  continuancePressure: 3,
  neighborPressure: 3,
  shellClusterProximity: 3,
  ownershipChurn: 2,
  infrastructureInvestment: 3,
  corridorAdjacency: 2,
};

/** Half-life in days for recency decay. After this many days since last
 *  signal, pressure is multiplied by 0.5. Chosen to match the MI-6
 *  temporalProximity half-life so the two layers align. */
export const PRESSURE_RECENCY_HALF_LIFE_DAYS = 60;

export interface ParcelMemoryActorContext {
  userId: string | null;
  email: string | null;
}

// ── Adjacency + corridor + cluster detection ─────────────────────────────────

export interface AdjacencyInferenceInput {
  parcelId: string;
  primaryAddress: string | null;
  jurisdiction: string | null;
  centroidLat: number | null;
  centroidLng: number | null;
}

export interface CorridorDetectionResult {
  parcelId: string;
  isOnCorridor: boolean;
  corridorMembers: string[]; // parcel ids forming the corridor
  reason: string;
}

export interface SpeculativeClusterResult {
  parcelId: string;
  isSpeculativeCluster: boolean;
  clusterMembers: string[];
  reason: string;
}

export interface RepeatedDeveloperFootprintResult {
  parcelId: string;
  isRepeatedFootprint: boolean;
  developerEntityIds: string[];
  otherParcelIds: string[];
  reason: string;
}
