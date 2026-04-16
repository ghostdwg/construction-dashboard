// Module CSI1 — canonical title enrichment helpers.
//
// Looks up a parsed CSI code in the CsiMasterformat seed data. Because
// non-standard spec books (e.g., KCG's "06-020" format) can normalize to CSI
// numbers that don't match their intended MasterFormat title, we only accept
// a canonical match when at least one meaningful word overlaps between the
// doc's title and MasterFormat's canonical title. False positives are worse
// than nulls for this workflow.

import { prisma } from "@/lib/prisma";

const STOPWORDS = new Set([
  "and", "the", "for", "with", "of", "to", "or", "in", "on", "at",
  "a", "an", "by", "as", "is", "be", "are",
]);

function meaningfulTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
  );
}

/** True if the two titles share at least one non-trivial word. */
export function titlesOverlap(a: string, b: string): boolean {
  const aTokens = meaningfulTokens(a);
  const bTokens = meaningfulTokens(b);
  for (const t of aTokens) if (bTokens.has(t)) return true;
  return false;
}

/**
 * Look up the canonical MasterFormat title for a CSI number. Returns the
 * canonical title if (a) the code exists AND (b) its title overlaps with
 * the supplied docTitle. Returns null otherwise (mismatch not safe to use).
 */
export async function lookupCanonicalTitle(
  csiNumber: string,
  docTitle: string
): Promise<string | null> {
  const normalized = csiNumber.trim();
  const master = await prisma.csiMasterformat.findUnique({
    where: { csiNumber: normalized },
    select: { canonicalTitle: true },
  });
  if (!master) return null;
  if (!titlesOverlap(docTitle, master.canonicalTitle)) return null;
  return master.canonicalTitle;
}

/** Bulk version — one DB query for a list of codes, returns safe matches only. */
export async function lookupCanonicalTitles(
  sections: Array<{ csiNumber: string; docTitle: string }>
): Promise<Map<string, string>> {
  const codes = Array.from(new Set(sections.map((s) => s.csiNumber.trim())));
  const rows = await prisma.csiMasterformat.findMany({
    where: { csiNumber: { in: codes } },
    select: { csiNumber: true, canonicalTitle: true },
  });
  const byCode = new Map(rows.map((r) => [r.csiNumber, r.canonicalTitle]));

  const result = new Map<string, string>();
  for (const s of sections) {
    const canonical = byCode.get(s.csiNumber.trim());
    if (canonical && titlesOverlap(s.docTitle, canonical)) {
      result.set(s.csiNumber.trim(), canonical);
    }
  }
  return result;
}
