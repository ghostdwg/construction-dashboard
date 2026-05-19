// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/parcelMemory/score.ts
//  Phase MI-7 — Bigram Dice's coefficient string similarity for parcel refs.
//
//  Pure function, zero dependencies. Inputs should already be normalized via
//  normalizeParcelRef() — this function compares lowercase alphanumeric
//  strings, not raw display refs.
//
//  We reuse the same bigram Dice's coefficient as the entity resolver
//  (lib/services/entityResolver/score.ts) for the same reasons:
//    - Symmetric, intuitive, length-tolerant
//    - O(n+m) time
//    - Empirically robust for typo-style fuzzy matching in addresses
// ──────────────────────────────────────────────────────────────────────────────

export function scoreParcelMatch(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const aBigrams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.slice(i, i + 2);
    aBigrams.set(bg, (aBigrams.get(bg) ?? 0) + 1);
  }

  let intersection = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.slice(i, i + 2);
    const count = aBigrams.get(bg);
    if (count && count > 0) {
      intersection++;
      aBigrams.set(bg, count - 1);
    }
  }

  return (2 * intersection) / (a.length + b.length - 2);
}
