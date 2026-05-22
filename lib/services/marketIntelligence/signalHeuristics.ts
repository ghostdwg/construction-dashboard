// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/marketIntelligence/signalHeuristics.ts
//  Phase O2.2 PR2 — Signal hygiene + emergence classifier.
//
//  Pure, deterministic, explainable signal triage. Takes a single signal
//  (plus optional contextual history) and returns a versioned factor
//  breakdown + a clamped emergence score + a coarse classification.
//
//  Hard rules — these are governance, not preferences:
//    * NO embeddings.
//    * NO machine learning.
//    * NO LLM ranking.
//    * NO opaque scoring — every contribution to the score must be a named
//      factor with a fixed integer-weighted contribution.
//    * Deterministic: same input → same output, byte-for-byte.
//    * Replayable: a stored factor list at version V1 can be re-evaluated by
//      a V2 reader and the V1 reasoning is preserved.
//    * Inspectable: every factor includes a human-readable `detail` string.
//
//  This module is consumed by:
//    * persistSidecarPayload (PR3 wiring) — filters before persistence.
//    * municipal-agenda-ingestion runner (PR5) — bulk classifies a batch.
//    * Operator UI (later) — explainable factor display.
//
//  Bump HEURISTICS_VERSION whenever weights or factor taxonomy changes.
//  Persisted classifications include the version they were produced under,
//  so historical decisions remain interpretable.
// ──────────────────────────────────────────────────────────────────────────────

// O2.2 PR6 — bumped from v1 to v2 with the governance-subtype additions
// (CODE_ADOPTION, ORDINANCE_CHANGE, ZONING_REWRITE, DENSITY_EXPANSION,
// TIF_APPROVAL, MORATORIUM, INFRASTRUCTURE_FUNDING) + governance suppressions
// (PROCEDURAL_READING, NON_DEVELOPMENT_RESOLUTION). v1 factor lists persist
// verbatim on existing MarketSignal rows and remain decodable; new rows write
// v2 reasoning. v2 readers handle both.
export const HEURISTICS_VERSION = "v2" as const;

// ── Factor taxonomy ─────────────────────────────────────────────────────────
//
// Two buckets: BOOST (positive weight) and SUPPRESS (negative weight). Every
// factor instance carries: kind, signed weight, bucket, and optional detail.
//
// Adding a new factor → bump HEURISTICS_VERSION. Removing a factor → bump
// AND keep the type alias for backward decoder support.

export type FactorBucket = "BOOST" | "SUPPRESS";

export type FactorKind =
  // ── Boosts (subtype-driven) ───────────────────────────────────────────────
  | "ANNEXATION"
  | "REZONING"
  | "PLAT"
  | "SITE_PLAN"
  | "VARIANCE"
  | "SUP_CUP"
  | "COMPREHENSIVE_PLAN"
  | "TIF"
  | "BOND"
  // ── Boosts (infrastructure / industrial / value) ──────────────────────────
  | "UTILITY_EXPANSION"
  | "CORRIDOR_STUDY"
  | "INFRASTRUCTURE_PLAN"
  | "INDUSTRIAL_REZONING"
  | "LOGISTICS_HINT"
  | "HIGH_VALUE"
  // ── Boosts (pattern / recurrence) ─────────────────────────────────────────
  | "RECURRING_DEVELOPER"
  | "RECURRING_PARCEL"
  | "RECURRING_JURISDICTION"
  | "MULTI_MEETING_APPEARANCE"
  // ── Boosts (governance — PR6, v2) ─────────────────────────────────────────
  // Governance-emergence signals: policy/regulatory actions that materially
  // change WHAT can be built, WHERE, or with WHAT FUNDING — distinct from
  // single-project entitlement actions (REZONING, SITE_PLAN, etc.).
  | "CODE_ADOPTION"          // new building code adopted (IBC, IRC, etc.)
  | "ORDINANCE_CHANGE"       // generic ordinance amendment
  | "ZONING_REWRITE"         // comprehensive zoning-code overhaul (5-year event)
  | "DENSITY_EXPANSION"      // density bonus / ADU allowance / height increase / FAR
  | "TIF_APPROVAL"           // new TIF district approved or expanded (distinct from generic TIF subtype)
  | "MORATORIUM"             // moratorium imposed — policy shift signal even though it pauses dev
  | "INFRASTRUCTURE_FUNDING" // funding actually awarded (distinct from BOND authorization)
  // ── Suppressions (ceremonial / boilerplate) ───────────────────────────────
  | "CEREMONIAL_PATTERN"
  | "ROLL_CALL"
  | "AGENDA_APPROVAL"
  | "MINUTES_APPROVAL"
  | "CONSENT_BOILERPLATE"
  | "ADMINISTRATIVE_NOTICE"
  // ── Suppressions (governance noise — PR6, v2) ────────────────────────────
  | "PROCEDURAL_READING"           // "First Reading of Ordinance X" without substantive change
  | "NON_DEVELOPMENT_RESOLUTION"   // "Resolution in support of Veterans Day" etc.
  // ── Suppressions (duplication) ────────────────────────────────────────────
  | "DUPLICATE_CONTINUANCE"
  | "DUPLICATE_PACKET";

// Frozen weight table. The single source of truth. Changing a number here
// is a versioning event — bump HEURISTICS_VERSION above.
//
// Convention: positive = boost, negative = suppression. Magnitudes scaled
// so that a typical mid-strength signal scores ~0.55 and a noisy/ceremonial
// item is forced below the SUPPRESS threshold.
const FACTOR_WEIGHTS: Readonly<Record<FactorKind, number>> = Object.freeze({
  // Boosts (subtype-driven)
  ANNEXATION: 0.30,
  REZONING: 0.20,
  PLAT: 0.18,
  SITE_PLAN: 0.18,
  VARIANCE: 0.10,
  SUP_CUP: 0.12,
  COMPREHENSIVE_PLAN: 0.25,
  TIF: 0.20,
  BOND: 0.15,
  // Boosts (infra / industrial / value)
  UTILITY_EXPANSION: 0.30,
  CORRIDOR_STUDY: 0.25,
  INFRASTRUCTURE_PLAN: 0.22,
  INDUSTRIAL_REZONING: 0.25,
  LOGISTICS_HINT: 0.15,
  HIGH_VALUE: 0.15,
  // Boosts (pattern / recurrence)
  RECURRING_DEVELOPER: 0.15,
  RECURRING_PARCEL: 0.10,
  RECURRING_JURISDICTION: 0.05,
  MULTI_MEETING_APPEARANCE: 0.10,
  // Boosts (governance — PR6, v2). ZONING_REWRITE / INFRASTRUCTURE_FUNDING
  // are the strongest at +0.35 because they're rare, infrequent events with
  // material downstream impact. MORATORIUM is positive (signals policy
  // movement) but lower at +0.15 — the dev pause is real but the underlying
  // shift is the signal.
  CODE_ADOPTION: 0.20,
  ORDINANCE_CHANGE: 0.15,
  ZONING_REWRITE: 0.35,
  DENSITY_EXPANSION: 0.30,
  TIF_APPROVAL: 0.30,
  MORATORIUM: 0.15,
  INFRASTRUCTURE_FUNDING: 0.35,
  // Suppressions (ceremonial)
  CEREMONIAL_PATTERN: -0.30,
  ROLL_CALL: -0.60,
  AGENDA_APPROVAL: -0.60,
  MINUTES_APPROVAL: -0.55,
  CONSENT_BOILERPLATE: -0.40,
  ADMINISTRATIVE_NOTICE: -0.30,
  // Suppressions (governance noise — PR6, v2)
  PROCEDURAL_READING: -0.30,
  NON_DEVELOPMENT_RESOLUTION: -0.45,
  // Suppressions (duplication)
  DUPLICATE_CONTINUANCE: -0.35,
  DUPLICATE_PACKET: -0.65,
});

// Any single suppression factor at-or-below this weight forces a hard drop
// regardless of competing boosts. Protects against pattern-matching boosts
// spuriously rescuing an obviously-ceremonial item.
const HARD_DROP_THRESHOLD = -0.50;

// Score thresholds (post-clamp).
//
// BASE_SCORE is set so that a no-factor signal lands cleanly in LOW_EMERGENCE
// (a signal with nothing notable about it should not auto-promote to MEDIUM),
// AND so that a single -0.30 ceremonial factor (the lightest suppression in
// the table) drops it cleanly below SUPPRESS_BELOW.
const BASE_SCORE = 0.35;
const SUPPRESS_BELOW = 0.10;
const LOW_BELOW = 0.40;
const MEDIUM_BELOW = 0.70;

// ── Public types ────────────────────────────────────────────────────────────

export interface HeuristicFactor {
  kind: FactorKind;
  weight: number;
  bucket: FactorBucket;
  detail: string;
}

export type SignalClassification =
  | "SUPPRESSED"
  | "LOW_EMERGENCE"
  | "MEDIUM_EMERGENCE"
  | "HIGH_EMERGENCE";

export interface HeuristicResult {
  score: number;
  classification: SignalClassification;
  factors: HeuristicFactor[];
  shouldDrop: boolean;
  heuristicsVersion: typeof HEURISTICS_VERSION;
}

export interface SignalContext {
  /** Developer/owner/architect names observed on prior signals (last 90d).
   *  Lowercased + suffix-stripped before being added to the set. */
  recentDeveloperNames?: ReadonlySet<string>;
  /** Parcel ids/hints observed on prior signals (last 90d). */
  recentParcels?: ReadonlySet<string>;
  /** Jurisdiction → signal count map (last 30d). */
  recentJurisdictions?: ReadonlyMap<string, number>;
  /** Last 30 headlines from the same source (most-recent first), used to
   *  detect DUPLICATE_CONTINUANCE via token-set Jaccard ≥ 0.80. */
  recentHeadlines?: readonly string[];
  /** Hashes of recent doc packets — used to detect DUPLICATE_PACKET. */
  recentDocHashes?: ReadonlySet<string>;
  /** Project keys (parcel || developer || jurisdiction) seen across N
   *  distinct meetings — fuels MULTI_MEETING_APPEARANCE. */
  projectKeyMeetingCounts?: ReadonlyMap<string, number>;
}

export interface HeuristicInput {
  headline: string;
  signalType: string;
  signalSubtype?: string | null;
  rawText?: string | null;
  /** Parsed metadata bag (the JSON-decoded contents of MarketSignal.metadata). */
  metadata?: Record<string, unknown> | null;
  /** Document publication date (used to scope time-bounded factors). */
  documentDate?: Date | null;
  jurisdiction?: string | null;
  /** Caller-computed packet hash (e.g. sha1 of normalized raw_text). */
  docPacketHash?: string | null;
  context?: SignalContext;
}

// ── Pure utilities ──────────────────────────────────────────────────────────

/** Token-set Jaccard similarity. Pure; case-insensitive; ignores tokens
 *  shorter than 3 chars (stopword-lite). */
export function tokenSetSimilarity(a: string, b: string): number {
  const toks = (s: string): Set<string> => {
    const out = new Set<string>();
    for (const t of s.toLowerCase().split(/[^a-z0-9]+/)) {
      if (t.length >= 3) out.add(t);
    }
    return out;
  };
  const A = toks(a);
  const B = toks(b);
  if (A.size === 0 || B.size === 0) return 0;
  let intersect = 0;
  for (const t of A) if (B.has(t)) intersect += 1;
  return intersect / (A.size + B.size - intersect);
}

/**
 * Deterministic actor-name normalization. Exported so context builders
 * (lib/services/marketIntelligence/heuristicsContext.ts) produce the same
 * normalized form the RECURRING_DEVELOPER detector expects.
 *
 * Lowercases, strips common corporate suffixes ("LLC", "Inc", "Corp",
 * "Company", "The", "Holdings", "Partners", "Group", "LLP", "Ltd"), removes
 * non-alphanumeric characters. Empty input → empty string.
 */
export function normalizeName(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .replace(/\b(llc|inc|corp|company|the|holdings|partners|group|llp|ltd)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function readMetaString(meta: Record<string, unknown> | null | undefined, key: string): string | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function readMetaNumber(meta: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!meta) return null;
  const v = meta[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function readMetaStringArray(meta: Record<string, unknown> | null | undefined, key: string): string[] {
  if (!meta) return [];
  const v = meta[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.length > 0);
}

function makeFactor(kind: FactorKind, detail: string): HeuristicFactor {
  const weight = FACTOR_WEIGHTS[kind];
  return { kind, weight, bucket: weight >= 0 ? "BOOST" : "SUPPRESS", detail };
}

// ── Subtype boost mapping ────────────────────────────────────────────────────
//
// Drives subtype-based boosts deterministically. Subtype values match the
// VALID_SUBTYPES set in sidecarMarket.ts (extended for utility/corridor in
// PR6 sidecar prompt update).

const SUBTYPE_FACTOR: Readonly<Record<string, FactorKind>> = Object.freeze({
  ANNEXATION: "ANNEXATION",
  REZONING: "REZONING",
  PLAT: "PLAT",
  SITE_PLAN: "SITE_PLAN",
  VARIANCE: "VARIANCE",
  SUP_CUP: "SUP_CUP",
  COMPREHENSIVE_PLAN: "COMPREHENSIVE_PLAN",
  TIF: "TIF",
  BOND: "BOND",
  UTILITY_EXPANSION: "UTILITY_EXPANSION",
  CORRIDOR_STUDY: "CORRIDOR_STUDY",
  INFRASTRUCTURE_PLAN: "INFRASTRUCTURE_PLAN",
  INDUSTRIAL_REZONING: "INDUSTRIAL_REZONING",
  // O2.2 PR6 — governance subtypes (v2)
  CODE_ADOPTION: "CODE_ADOPTION",
  ORDINANCE_CHANGE: "ORDINANCE_CHANGE",
  ZONING_REWRITE: "ZONING_REWRITE",
  DENSITY_EXPANSION: "DENSITY_EXPANSION",
  TIF_APPROVAL: "TIF_APPROVAL",
  MORATORIUM: "MORATORIUM",
  INFRASTRUCTURE_FUNDING: "INFRASTRUCTURE_FUNDING",
});

// ── Detectors (pure, no side effects) ───────────────────────────────────────

function detectSubtype(input: HeuristicInput): HeuristicFactor[] {
  const sub = input.signalSubtype?.toUpperCase();
  if (!sub) return [];
  const kind = SUBTYPE_FACTOR[sub];
  if (!kind) return [];
  return [makeFactor(kind, `signal subtype = ${sub}`)];
}

const CEREMONIAL_HEAD_REGEXES: ReadonlyArray<{ kind: FactorKind; re: RegExp; detail: string }> = [
  { kind: "ROLL_CALL",         re: /\b(roll\s*call|attendance\s*call)\b/i,                     detail: "headline matches roll-call pattern" },
  { kind: "AGENDA_APPROVAL",   re: /\b(approval\s+of\s+(the\s+)?agenda|agenda\s+approval)\b/i, detail: "headline matches agenda-approval pattern" },
  { kind: "MINUTES_APPROVAL",  re: /\b(approval\s+of\s+(the\s+)?minutes|minutes\s+approval)\b/i, detail: "headline matches minutes-approval pattern" },
  { kind: "CONSENT_BOILERPLATE", re: /\b(consent\s+(agenda|calendar|items?)|routine\s+matters)\b/i, detail: "headline matches consent-boilerplate pattern" },
  { kind: "CEREMONIAL_PATTERN", re: /^\s*(invocation|pledge\s+of\s+allegiance|moment\s+of\s+silence|welcome|adjournment|recess|swearing\s*in|oath\s+of\s+office|reorganization|recognition|proclamation|introduction)\b/i, detail: "headline starts with ceremonial keyword" },
  { kind: "ADMINISTRATIVE_NOTICE", re: /\b(public\s+notice|notice\s+of\s+(hearing|meeting|cancell?ation)|posting\s+notice|hereby\s+given)\b/i, detail: "headline matches administrative-notice pattern" },
  // O2.2 PR6 — governance-noise suppression (v2)
  { kind: "PROCEDURAL_READING", re: /^\s*(first|second|third)\s+reading(\s+of)?\b/i, detail: "headline matches procedural-reading pattern (Nth Reading of Ordinance)" },
  { kind: "NON_DEVELOPMENT_RESOLUTION", re: /^\s*resolution\s+(in\s+support\s+of|recognizing|honoring|congratulating|declaring|proclaiming|commending|celebrating|memorializing|condemning)\b/i, detail: "headline matches non-development resolution pattern" },
];

function detectCeremonial(input: HeuristicInput): HeuristicFactor[] {
  const headline = input.headline ?? "";
  const out: HeuristicFactor[] = [];
  for (const { kind, re, detail } of CEREMONIAL_HEAD_REGEXES) {
    if (re.test(headline)) out.push(makeFactor(kind, detail));
  }
  return out;
}

const UTILITY_RE = /\b(sewer|water\s+main|lift\s+station|treatment\s+plant|water\s+tower|sanitary\s+sewer|water\s+line|sewer\s+expansion|water\s+expansion|sewer\s+extension|water\s+extension|trunk\s+line|sewer\s+district)\b/i;
const CORRIDOR_RE = /\b(corridor\s+study|transportation\s+corridor|growth\s+corridor|corridor\s+plan)\b/i;
const INFRA_RE = /\b(capital\s+improvement\s+plan|\bcip\b|transportation\s+improvement|comprehensive\s+infrastructure|streetscape\s+(plan|improvements?))\b/i;
const LOGISTICS_RE = /\b(distribution\s+center|fulfillment\s+center|logistics\s+(center|facility|hub)|rail\s+spur|intermodal|cross[-\s]?dock)\b/i;
const INDUSTRIAL_REZONING_RE = /\b(industrial|manufacturing|warehouse|distribution|logistics)\b/i;
const ANNEX_RE = /\b(annex(ation|ed|ing)?)\b/i;

// ── O2.2 PR6 — governance keyword detectors (v2) ───────────────────────────
// Used when Claude tagged the signal with a non-governance subtype but the
// headline/raw text contains governance-emergence language. Mirrors the
// dual-path pattern used for UTILITY_EXPANSION / CORRIDOR_STUDY in v1.
const ZONING_REWRITE_RE = /\b(comprehensive\s+(zoning|rezoning)\s+(rewrite|update|overhaul|amendment)|zoning\s+(code|ordinance)\s+(rewrite|overhaul|update)|zoning\s+text\s+amendment|new\s+zoning\s+ordinance)\b/i;
const DENSITY_EXPANSION_RE = /\b(density\s+bonus|adu\s+(allowance|policy)|accessory\s+dwelling\s+unit|height\s+(increase|limit\s+raised)|FAR\s+(increase|amendment)|missing\s+middle|up-?zoning)\b/i;
const MORATORIUM_RE = /\b(moratorium|temporary\s+(pause|halt|prohibition)\s+on|interim\s+(zoning|ordinance))\b/i;
const TIF_APPROVAL_RE = /\b(TIF\s+district\s+(approved|established|created|expanded|extended)|tax\s+increment\s+financing\s+district\s+(approved|established|created))\b/i;
const INFRA_FUNDING_RE = /\b(infrastructure\s+(grant|funding|award|appropriation)|federal\s+(grant\s+award|funding\s+award)|state\s+(grant\s+award|funding\s+award)|capital\s+appropriation|ARPA\s+funds?)\b/i;
const CODE_ADOPTION_RE = /\b((adopting|adoption\s+of)\s+(the\s+)?(\d{4}\s+)?(international\s+(building|residential|fire|plumbing|mechanical|energy)\s+code|IBC|IRC|IFC|IPC|IMC|IECC)\b|building\s+code\s+(adoption|update))/i;
const ORDINANCE_CHANGE_RE = /\b(ordinance\s+(amendment|change|update)|code\s+amendment|amending\s+(chapter|section)\s+\d)\b/i;

function detectKeywordBoosts(input: HeuristicInput): HeuristicFactor[] {
  const haystack = `${input.headline ?? ""}\n${input.rawText ?? ""}`;
  const out: HeuristicFactor[] = [];

  // Annexation: subtype path already covers this, but headline-only mentions
  // (rezoning packet that includes annexation language) deserve a hit too.
  if (input.signalSubtype?.toUpperCase() !== "ANNEXATION" && ANNEX_RE.test(haystack)) {
    out.push(makeFactor("ANNEXATION", "headline/raw text contains annexation keyword"));
  }
  if (input.signalSubtype?.toUpperCase() !== "UTILITY_EXPANSION" && UTILITY_RE.test(haystack)) {
    out.push(makeFactor("UTILITY_EXPANSION", "headline/raw text contains utility-expansion keyword"));
  }
  if (input.signalSubtype?.toUpperCase() !== "CORRIDOR_STUDY" && CORRIDOR_RE.test(haystack)) {
    out.push(makeFactor("CORRIDOR_STUDY", "headline/raw text contains corridor-study keyword"));
  }
  if (input.signalSubtype?.toUpperCase() !== "INFRASTRUCTURE_PLAN" && INFRA_RE.test(haystack)) {
    out.push(makeFactor("INFRASTRUCTURE_PLAN", "headline/raw text contains infrastructure-plan keyword"));
  }
  if (LOGISTICS_RE.test(haystack)) {
    out.push(makeFactor("LOGISTICS_HINT", "headline/raw text contains logistics/distribution keyword"));
  }
  // Industrial-rezoning: piggyback on REZONING subtype + industrial keyword.
  if (input.signalSubtype?.toUpperCase() === "REZONING" && INDUSTRIAL_REZONING_RE.test(haystack)) {
    out.push(makeFactor("INDUSTRIAL_REZONING", "rezoning + industrial/manufacturing/warehouse keyword"));
  }
  // O2.2 PR6 — governance keyword detection (v2). Same subtype-vs-keyword
  // dual-path: fire from keyword when the subtype didn't already cover it.
  // This catches governance signals that Claude tagged as a generic
  // ORDINANCE_CHANGE or OTHER but whose text reveals stronger semantics.
  const sub = input.signalSubtype?.toUpperCase();
  if (sub !== "ZONING_REWRITE" && ZONING_REWRITE_RE.test(haystack)) {
    out.push(makeFactor("ZONING_REWRITE", "headline/raw text matches comprehensive-zoning rewrite pattern"));
  }
  if (sub !== "DENSITY_EXPANSION" && DENSITY_EXPANSION_RE.test(haystack)) {
    out.push(makeFactor("DENSITY_EXPANSION", "headline/raw text matches density-expansion keyword"));
  }
  if (sub !== "MORATORIUM" && MORATORIUM_RE.test(haystack)) {
    out.push(makeFactor("MORATORIUM", "headline/raw text mentions moratorium / temporary pause"));
  }
  if (sub !== "TIF_APPROVAL" && TIF_APPROVAL_RE.test(haystack)) {
    out.push(makeFactor("TIF_APPROVAL", "headline/raw text matches TIF-district approval pattern"));
  }
  if (sub !== "INFRASTRUCTURE_FUNDING" && INFRA_FUNDING_RE.test(haystack)) {
    out.push(makeFactor("INFRASTRUCTURE_FUNDING", "headline/raw text matches infrastructure-funding-award keyword"));
  }
  if (sub !== "CODE_ADOPTION" && CODE_ADOPTION_RE.test(haystack)) {
    out.push(makeFactor("CODE_ADOPTION", "headline/raw text matches building-code adoption pattern"));
  }
  if (sub !== "ORDINANCE_CHANGE" && ORDINANCE_CHANGE_RE.test(haystack)) {
    out.push(makeFactor("ORDINANCE_CHANGE", "headline/raw text matches ordinance-amendment pattern"));
  }
  return out;
}

const HIGH_VALUE_THRESHOLD = 5_000_000;

function detectHighValue(input: HeuristicInput): HeuristicFactor[] {
  const v = readMetaNumber(input.metadata ?? null, "estimated_value");
  if (v != null && v >= HIGH_VALUE_THRESHOLD) {
    return [makeFactor("HIGH_VALUE", `estimated_value ${v.toLocaleString()} >= ${HIGH_VALUE_THRESHOLD.toLocaleString()}`)];
  }
  return [];
}

/** Returns the union of normalized actor names (developer + owner + architect
 *  + GCs) extracted from metadata. Pure. */
function extractActorNames(input: HeuristicInput): string[] {
  const meta = input.metadata ?? null;
  const names: string[] = [];
  const owner = readMetaString(meta, "owner_name");
  if (owner) names.push(owner);
  const developer = readMetaString(meta, "developer_name");
  if (developer) names.push(developer);
  const architect = readMetaString(meta, "architect_name");
  if (architect) names.push(architect);
  for (const gc of readMetaStringArray(meta, "gc_names")) names.push(gc);
  for (const sub of readMetaStringArray(meta, "sub_names")) names.push(sub);
  return names;
}

function detectRecurringDeveloper(input: HeuristicInput): HeuristicFactor[] {
  const recent = input.context?.recentDeveloperNames;
  if (!recent || recent.size === 0) return [];
  const names = extractActorNames(input);
  for (const raw of names) {
    const norm = normalizeName(raw);
    if (norm && recent.has(norm)) {
      return [makeFactor("RECURRING_DEVELOPER", `actor "${raw}" appeared in prior signals (last 90d)`)];
    }
  }
  return [];
}

function detectRecurringParcel(input: HeuristicInput): HeuristicFactor[] {
  const recent = input.context?.recentParcels;
  if (!recent || recent.size === 0) return [];
  const parcel = readMetaString(input.metadata ?? null, "parcel_id");
  if (!parcel) return [];
  if (recent.has(parcel)) {
    return [makeFactor("RECURRING_PARCEL", `parcel ${parcel} appeared in prior signals (last 90d)`)];
  }
  return [];
}

const RECURRING_JURISDICTION_THRESHOLD = 5;

function detectRecurringJurisdiction(input: HeuristicInput): HeuristicFactor[] {
  const recent = input.context?.recentJurisdictions;
  if (!recent || !input.jurisdiction) return [];
  const count = recent.get(input.jurisdiction) ?? 0;
  if (count >= RECURRING_JURISDICTION_THRESHOLD) {
    return [makeFactor("RECURRING_JURISDICTION", `jurisdiction "${input.jurisdiction}" has ${count} recent signals (last 30d)`)];
  }
  return [];
}

const MULTI_MEETING_THRESHOLD = 3;

function buildProjectKey(input: HeuristicInput): string | null {
  const parcel = readMetaString(input.metadata ?? null, "parcel_id");
  if (parcel) return `parcel:${parcel}`;
  const names = extractActorNames(input);
  for (const n of names) {
    const norm = normalizeName(n);
    if (norm) return `actor:${norm}`;
  }
  if (input.jurisdiction) return `jurisdiction:${input.jurisdiction.toLowerCase()}`;
  return null;
}

function detectMultiMeetingAppearance(input: HeuristicInput): HeuristicFactor[] {
  const counts = input.context?.projectKeyMeetingCounts;
  if (!counts) return [];
  const key = buildProjectKey(input);
  if (!key) return [];
  const count = counts.get(key) ?? 0;
  if (count >= MULTI_MEETING_THRESHOLD) {
    return [makeFactor("MULTI_MEETING_APPEARANCE", `project key "${key}" seen in ${count} distinct meetings`)];
  }
  return [];
}

const CONTINUANCE_SIMILARITY_THRESHOLD = 0.80;

function detectDuplicateContinuance(input: HeuristicInput): HeuristicFactor[] {
  const recent = input.context?.recentHeadlines;
  if (!recent || recent.length === 0) return [];
  for (const prior of recent) {
    const sim = tokenSetSimilarity(input.headline, prior);
    if (sim >= CONTINUANCE_SIMILARITY_THRESHOLD) {
      return [makeFactor(
        "DUPLICATE_CONTINUANCE",
        `headline token-similarity ${sim.toFixed(2)} vs prior "${prior.slice(0, 60)}${prior.length > 60 ? "…" : ""}"`,
      )];
    }
  }
  return [];
}

function detectDuplicatePacket(input: HeuristicInput): HeuristicFactor[] {
  const recent = input.context?.recentDocHashes;
  if (!recent || !input.docPacketHash) return [];
  if (recent.has(input.docPacketHash)) {
    return [makeFactor("DUPLICATE_PACKET", `docPacketHash ${input.docPacketHash} already observed`)];
  }
  return [];
}

// ── Main classifier ────────────────────────────────────────────────────────

const DETECTORS: ReadonlyArray<(input: HeuristicInput) => HeuristicFactor[]> = Object.freeze([
  detectSubtype,
  detectCeremonial,
  detectKeywordBoosts,
  detectHighValue,
  detectRecurringDeveloper,
  detectRecurringParcel,
  detectRecurringJurisdiction,
  detectMultiMeetingAppearance,
  detectDuplicateContinuance,
  detectDuplicatePacket,
]);

function classify(score: number, hardDropTripped: boolean): SignalClassification {
  if (hardDropTripped) return "SUPPRESSED";
  if (score < SUPPRESS_BELOW) return "SUPPRESSED";
  if (score < LOW_BELOW) return "LOW_EMERGENCE";
  if (score < MEDIUM_BELOW) return "MEDIUM_EMERGENCE";
  return "HIGH_EMERGENCE";
}

function dedupeFactors(factors: HeuristicFactor[]): HeuristicFactor[] {
  // Same FactorKind firing twice (e.g. ANNEXATION from subtype AND keyword)
  // counts once. Keep the first occurrence (which carries the most specific
  // detail string in our detector ordering).
  const seen = new Set<FactorKind>();
  const out: HeuristicFactor[] = [];
  for (const f of factors) {
    if (seen.has(f.kind)) continue;
    seen.add(f.kind);
    out.push(f);
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Classify a single signal. Pure: same input → same output.
 *
 * Score derivation:
 *   score = clamp(0.40 + sum(factor weights), 0.0, 1.0)
 *
 * Hard-drop rule (overrides score):
 *   If any single factor has weight ≤ -0.50, classification is SUPPRESSED
 *   regardless of boosts. Protects against pattern-matching boosts spuriously
 *   rescuing an obviously-ceremonial item.
 *
 * Classification bands:
 *   score < 0.10  → SUPPRESSED (also when hard-drop fires)
 *   < 0.40        → LOW_EMERGENCE
 *   < 0.70        → MEDIUM_EMERGENCE
 *   ≥ 0.70        → HIGH_EMERGENCE
 *
 * shouldDrop = (classification === "SUPPRESSED"). Callers persist
 * non-SUPPRESSED signals; SUPPRESSED signals should not become MarketSignal
 * rows (or, if persisted for traceability, are excluded from project
 * aggregation).
 */
export function classifySignal(input: HeuristicInput): HeuristicResult {
  const allFactors: HeuristicFactor[] = [];
  for (const detector of DETECTORS) {
    for (const f of detector(input)) allFactors.push(f);
  }
  const factors = dedupeFactors(allFactors);

  let sum = 0;
  let hardDropTripped = false;
  for (const f of factors) {
    sum += f.weight;
    if (f.weight <= HARD_DROP_THRESHOLD) hardDropTripped = true;
  }

  const raw = BASE_SCORE + sum;
  const score = Number(clamp(raw, 0, 1).toFixed(4));
  const classification = classify(score, hardDropTripped);

  return {
    score,
    classification,
    factors,
    shouldDrop: classification === "SUPPRESSED",
    heuristicsVersion: HEURISTICS_VERSION,
  };
}

// ── Re-exports for testability / external introspection ────────────────────

export const __internals = {
  FACTOR_WEIGHTS,
  HARD_DROP_THRESHOLD,
  BASE_SCORE,
  SUPPRESS_BELOW,
  LOW_BELOW,
  MEDIUM_BELOW,
  CONTINUANCE_SIMILARITY_THRESHOLD,
  HIGH_VALUE_THRESHOLD,
  RECURRING_JURISDICTION_THRESHOLD,
  MULTI_MEETING_THRESHOLD,
} as const;
