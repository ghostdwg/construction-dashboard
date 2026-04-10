// Fuzzy trade name matcher
//
// Matches incoming trade strings (from Procore CSV or generic import) against
// the existing 46-trade dictionary in the Trade table. Uses normalized
// substring matching first, then word-overlap scoring as fallback.

export type TradeMatch = {
  source: string;        // Original trade string from CSV
  matched: { id: number; name: string } | null;
  confidence: "exact" | "fuzzy" | "none";
};

function normalize(s: string): string {
  return s.toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokenize and remove common stop words
const STOP_WORDS = new Set(["and", "the", "of", "for", "a", "an", "&"]);

function tokenize(s: string): Set<string> {
  return new Set(
    normalize(s)
      .split(" ")
      .filter((t) => t && !STOP_WORDS.has(t))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function matchTradeNames(
  sources: string[],
  tradeDict: { id: number; name: string }[]
): TradeMatch[] {
  // Pre-normalize the dictionary
  const normalizedDict = tradeDict.map((t) => ({
    id: t.id,
    name: t.name,
    norm: normalize(t.name),
    tokens: tokenize(t.name),
  }));

  return sources.map((source) => {
    const sourceNorm = normalize(source);
    if (!sourceNorm) {
      return { source, matched: null, confidence: "none" as const };
    }

    // 1. Exact normalized match
    const exact = normalizedDict.find((t) => t.norm === sourceNorm);
    if (exact) {
      return {
        source,
        matched: { id: exact.id, name: exact.name },
        confidence: "exact" as const,
      };
    }

    // 2. Substring match either direction
    const substr = normalizedDict.find(
      (t) => t.norm.includes(sourceNorm) || sourceNorm.includes(t.norm)
    );
    if (substr) {
      return {
        source,
        matched: { id: substr.id, name: substr.name },
        confidence: "fuzzy" as const,
      };
    }

    // 3. Token Jaccard similarity (≥ 0.5 = match)
    const sourceTokens = tokenize(source);
    let best: { id: number; name: string; score: number } | null = null;
    for (const t of normalizedDict) {
      const score = jaccard(sourceTokens, t.tokens);
      if (score >= 0.5 && (!best || score > best.score)) {
        best = { id: t.id, name: t.name, score };
      }
    }
    if (best) {
      return {
        source,
        matched: { id: best.id, name: best.name },
        confidence: "fuzzy" as const,
      };
    }

    return { source, matched: null, confidence: "none" as const };
  });
}
