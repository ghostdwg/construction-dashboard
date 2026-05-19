// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/parcelMemory/normalize.ts
//  Phase MI-7 — Deterministic parcel-reference normalization.
//
//  Parcels arrive from many sources with wildly different formats:
//
//    "010-12345-678"         — Polk County assessor
//    "Polk Co 010-12345-678" — same, with county prefix
//    "5301 Mills Civic Pkwy" — street address
//    "5301 Mills Civic Pkway"— typo'd street address
//    "5301 mills civic"      — abbreviated
//    "Lot 7, Block 12, Westridge Plat 3" — legal description
//    "WATER ACCT 4429321"    — utility-service reference
//
//  Goal: a stable lowercase-alphanumeric form so common variants of the same
//  parcel collapse to the same dedup key for Pass-1 lookup. Variants that
//  DON'T collapse exactly fall through to fuzzy passes (resolver.ts).
//
//  Algorithm (in order):
//    1. lowercase + trim
//    2. classify the input → ASSESSOR | LEGAL | ADDRESS_ONLY | UTILITY | UNKNOWN
//    3. apply kind-specific normalization:
//       - ASSESSOR : strip county prefixes, hyphens, spaces → "01012345678"
//       - ADDRESS  : strip street-suffix variants ("pkwy"/"parkway"/"pkway"
//                    all collapse), unit numbers, directional prefixes
//       - LEGAL    : strip whitespace, punctuation; preserve numeric+letter
//                    tokens (lot, block, plat names)
//       - UTILITY  : strip provider prefix; keep numeric identifier
//       - UNKNOWN  : punctuation→space; collapse; concat
//    4. concatenate; strip any non-[a-z0-9]
//
//  Stability contract: changes to this file MUST bump PARCEL_RESOLVER_VERSION
//  in types.ts. Backfill records the version on each resolution so past
//  matches can be selectively re-evaluated when the algorithm evolves.
// ──────────────────────────────────────────────────────────────────────────────

import type { ParcelKind } from "./types";

// Order matters: longer phrases first so "polk county" matches before "polk co".
// A "polk county" reference must NOT first strip "polk co" and leave "unty ..."
const COUNTY_PREFIXES = [
  "polk county",
  "dallas county",
  "warren county",
  "story county",
  "linn county",
  "scott county",
  "johnson county",
  "polk co",
  "dallas co",
  "warren co",
  "story co",
  "linn co",
  "scott co",
  "johnson co",
];

const ASSESSOR_PARCEL_PATTERN = /^\s*[a-z\s]*\d{2,3}[-\s]?\d{3,5}[-\s]?\d{2,4}\s*$/i;

const UTILITY_PREFIXES = [
  "water acct",
  "water account",
  "sewer acct",
  "sewer account",
  "gas acct",
  "gas account",
  "electric acct",
  "fiber acct",
  "utility ref",
];

// Street-suffix collapse table. Both keys and values are matched as whole
// tokens at the end of an address. Note: spelling variants (pkway / pkwy /
// parkway) all collapse to "pkwy".
const STREET_SUFFIX_CANONICAL: Record<string, string> = {
  parkway: "pkwy",
  pkway: "pkwy",
  pkwy: "pkwy",
  pky: "pkwy",
  avenue: "ave",
  ave: "ave",
  av: "ave",
  street: "st",
  st: "st",
  road: "rd",
  rd: "rd",
  drive: "dr",
  dr: "dr",
  boulevard: "blvd",
  blvd: "blvd",
  lane: "ln",
  ln: "ln",
  court: "ct",
  ct: "ct",
  circle: "cir",
  cir: "cir",
  way: "way",
  trail: "trl",
  trl: "trl",
  place: "pl",
  pl: "pl",
  highway: "hwy",
  hwy: "hwy",
};

// Directional prefixes/suffixes — "N", "north", "E", etc. — collapse to
// single-letter form so "North Mills" and "N Mills" hash identically.
const DIRECTIONAL_CANONICAL: Record<string, string> = {
  north: "n",
  n: "n",
  south: "s",
  s: "s",
  east: "e",
  e: "e",
  west: "w",
  w: "w",
  northeast: "ne",
  ne: "ne",
  northwest: "nw",
  nw: "nw",
  southeast: "se",
  se: "se",
  southwest: "sw",
  sw: "sw",
};

// Unit indicators stripped from addresses ("Apt 12", "Suite 200", "#5").
const UNIT_PATTERN = /\s+(?:apt|apartment|suite|ste|unit|#)\s*\w+\s*$/i;

// A legal description has the "lot/block/section/township word followed by a
// number" structure. Plain street names ("Empty Lot Rd", "Forest Block Way")
// must NOT match — they're street-name uses, not parcel descriptors.
const LEGAL_DESCRIPTION_PATTERN = /\b(lot|block|section|township|tract)\s+\d|\bplat\s+\w/i;

export function classifyParcelKind(raw: string): ParcelKind {
  const s = raw.toLowerCase().trim();
  if (!s) return "UNKNOWN";

  // Utility account references take priority over assessor pattern because
  // some utility refs look like assessor ids.
  for (const prefix of UTILITY_PREFIXES) {
    if (s.startsWith(prefix)) return "UTILITY";
  }

  if (LEGAL_DESCRIPTION_PATTERN.test(s)) return "LEGAL";

  // County-prefixed assessor pattern: "Polk Co 010-12345-678"
  for (const prefix of COUNTY_PREFIXES) {
    if (s.startsWith(prefix)) {
      const rest = s.slice(prefix.length).trim();
      if (ASSESSOR_PARCEL_PATTERN.test(rest) || /^\d/.test(rest)) return "ASSESSOR";
    }
  }

  if (ASSESSOR_PARCEL_PATTERN.test(s)) return "ASSESSOR";

  // Has a number followed by words → likely an address.
  if (/^\d+\s+\S/.test(s)) return "ADDRESS_ONLY";

  return "UNKNOWN";
}

function normalizeAssessor(raw: string): string {
  let s = raw.toLowerCase().trim();
  for (const prefix of COUNTY_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length).trim();
      break;
    }
  }
  return s.replace(/[^a-z0-9]/g, "");
}

function normalizeAddress(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.replace(UNIT_PATTERN, "");

  // Punctuation → space, collapse whitespace
  s = s.replace(/[^a-z0-9\s]+/g, " ").replace(/\s+/g, " ").trim();

  const tokens = s.split(" ").filter((t) => t.length > 0);
  const out: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    // Directional canonicalization
    if (DIRECTIONAL_CANONICAL[tok]) {
      out.push(DIRECTIONAL_CANONICAL[tok]);
      continue;
    }
    // Street-suffix canonicalization
    if (STREET_SUFFIX_CANONICAL[tok]) {
      out.push(STREET_SUFFIX_CANONICAL[tok]);
      continue;
    }
    out.push(tok);
  }

  return out.join("").replace(/[^a-z0-9]/g, "");
}

function normalizeLegal(raw: string): string {
  const s = raw.toLowerCase().trim();
  // Keep ordering, drop punctuation, keep numbers + words.
  return s.replace(/[^a-z0-9]+/g, "");
}

function normalizeUtility(raw: string): string {
  let s = raw.toLowerCase().trim();
  for (const prefix of UTILITY_PREFIXES) {
    if (s.startsWith(prefix)) {
      s = s.slice(prefix.length).trim();
      break;
    }
  }
  return s.replace(/[^a-z0-9]/g, "");
}

function normalizeUnknown(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Produce a stable lowercase-alphanumeric dedup key for a parcel reference.
 *  Empty input returns "" — caller must treat that as un-normalizable. */
export function normalizeParcelRef(raw: string, kindHint?: ParcelKind): string {
  if (!raw) return "";
  const kind = kindHint ?? classifyParcelKind(raw);
  switch (kind) {
    case "ASSESSOR":
      return normalizeAssessor(raw);
    case "ADDRESS_ONLY":
      return normalizeAddress(raw);
    case "LEGAL":
      return normalizeLegal(raw);
    case "UTILITY":
      return normalizeUtility(raw);
    case "CORRIDOR":
    case "UNKNOWN":
    default:
      return normalizeUnknown(raw);
  }
}
