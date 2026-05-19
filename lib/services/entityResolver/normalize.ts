// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityResolver/normalize.ts
//  Phase MI-2 — Deterministic entity-name normalization.
//
//  Goal: produce a stable lowercase-alphanumeric form so common variants of
//  the same organization collapse to the same key for Pass-1 lookup.
//
//  The normalizer is intentionally *aggressive* — "Hubbell Realty Company"
//  and "Hubbell" both reduce to "hubbell". Distinct entities that genuinely
//  share a normalized form are disambiguated via EntityAlias rows (Pass 2)
//  or surface as candidates in Pass 3/4 fuzzy.
//
//  Algorithm (in order):
//    1. lowercase + trim
//    2. strip leading "the "
//    3. strip municipality prefixes ("city of ", "town of ", "village of ",
//       "county of ")
//    4. strip multi-word suffixes ("real estate", "general contractors",
//       "general construction")
//    5. punctuation → space; collapse whitespace; tokenize on spaces
//    6. greedily strip trailing entity-suffix tokens (llc, inc, corp,
//       company, group, holdings, realty, construction, architects, ...)
//       — leaves at least one token even if all are suffix-like
//    7. concatenate remaining tokens; strip any non-[a-z0-9] characters
//
//  Stability contract: changes to this file MUST bump RESOLVER_VERSION in
//  types.ts. MI-3 backfill records the version on each resolution so past
//  matches can be selectively re-evaluated when the algorithm evolves.
// ──────────────────────────────────────────────────────────────────────────────

const LEADING_ARTICLES = ["the "];

const MUNICIPALITY_PREFIXES = [
  "city of ",
  "town of ",
  "village of ",
  "county of ",
];

// Order matters slightly: longer phrases first so "real estate" matches before
// "estate" alone.
const MULTI_WORD_SUFFIXES = [
  "real estate",
  "general contractors",
  "general contractor",
  "general construction",
];

const ENTITY_SUFFIX_TOKENS = new Set<string>([
  // legal forms
  "llc", "inc", "incorporated", "corp", "corporation", "co", "company",
  "companies", "ltd", "limited", "llp", "lp", "plc",
  // ownership / operating forms
  "group", "holdings", "partners", "partnership", "enterprises", "ventures",
  "associates", "consultants",
  // industry descriptors
  "properties", "property", "realty", "real", "estate", "development",
  "developments", "developers", "construction", "builders", "building",
  "contractors", "architecture", "architects", "engineering", "engineers",
  "design", "consulting", "services",
]);

// Pre-tokenization rewrites for punctuated legal forms so "L.L.C." and "LLC"
// land in the same suffix-token bucket without depending on whether the dot
// happens to be adjacent to whitespace.
const LEGAL_FORM_REWRITES: Array<[RegExp, string]> = [
  [/\bl\.l\.c\.?\b/gi, "llc"],
  [/\bl\.l\.p\.?\b/gi, "llp"],
  [/\bp\.l\.c\.?\b/gi, "plc"],
  [/\bco\.\B/gi, "co"],
  [/\binc\.\B/gi, "inc"],
  [/\bcorp\.\B/gi, "corp"],
  [/\bltd\.\B/gi, "ltd"],
];

function stripPunctuation(s: string): string {
  // Map any non-letter / non-digit character to a single space, then collapse
  // runs of whitespace. This is what makes "L.L.C." token-equivalent to "llc"
  // and what dissolves "&" / "-" / "," cleanly.
  return s.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normalizeEntityName(name: string): string {
  if (!name) return "";
  let s = name.toLowerCase().trim();

  // Rewrite punctuated legal forms BEFORE punctuation-strip so "L.L.C."
  // becomes the single token "llc" rather than splitting into ["l", "l", "c"].
  for (const [pattern, replacement] of LEGAL_FORM_REWRITES) {
    s = s.replace(pattern, replacement);
  }

  for (const article of LEADING_ARTICLES) {
    if (s.startsWith(article)) s = s.slice(article.length).trim();
  }

  for (const prefix of MUNICIPALITY_PREFIXES) {
    if (s.startsWith(prefix)) s = s.slice(prefix.length).trim();
  }

  for (const suffix of MULTI_WORD_SUFFIXES) {
    const pattern = `[\\s,]+${suffix.replace(/\s/g, "[\\s,]+")}$`;
    s = s.replace(new RegExp(pattern, "i"), "").trim();
  }

  s = stripPunctuation(s);
  let tokens = s.split(" ").filter((t) => t.length > 0);

  // Strip trailing entity-suffix tokens, but always keep at least one token
  // so a name like "LLC" alone doesn't normalize to "" — it's an unusual
  // input the resolver should still see.
  while (tokens.length > 1 && ENTITY_SUFFIX_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens.join("").replace(/[^a-z0-9]/g, "");
}
