// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityResolver/score.ts
//  Phase MI-2 — Bigram Dice's coefficient string similarity.
//
//  Pure function, zero dependencies. Inputs should already be normalized via
//  normalizeEntityName() — this function compares lowercase alphanumeric
//  strings, not raw display names.
//
//  Returns a number in [0, 1]:
//    1.0  — identical
//    0.9+ — minor typo / abbreviation
//    0.7+ — typical fuzzy threshold; same name with descriptor differences
//    <0.5 — almost certainly different entities
//
//  Why bigram Dice's instead of Levenshtein:
//    - Symmetric, intuitive, length-tolerant
//    - O(n+m) time vs Levenshtein's O(n*m)
//    - Empirically robust for company-name similarity in the < 50-char range
// ──────────────────────────────────────────────────────────────────────────────

export function scoreEntityMatch(a: string, b: string): number {
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
