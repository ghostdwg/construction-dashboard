// GET /api/bids/[id]/spec-gaps/related?q=<text>&limit=<n>
//
// Returns SpecSections from the most recent SpecBook for this bid where:
//   - covered = false  (section is a coverage gap — no trade on the bid owns it)
//   - csiTitle keyword-overlaps with q tokens
//
// Used by the inline hint panel on TrackedItem create/edit and FieldReport
// item creation. No AI call — reads stored SpecSection data only.
// Auth: bid-scoped query (follows specbook/gaps route pattern — no session wall).

import { prisma } from "@/lib/prisma";

const STOPWORDS = new Set([
  "with", "from", "that", "this", "have", "will", "more", "than",
  "when", "also", "were", "been", "being", "they", "their", "over",
  "under", "each", "some", "into", "work", "area", "type",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limitParam = parseInt(searchParams.get("limit") ?? "5", 10);
  const limit = isNaN(limitParam) ? 5 : Math.max(1, Math.min(20, limitParam));

  const tokens = tokenize(q);
  if (tokens.length === 0) return Response.json({ sections: [], total: 0 });

  const specBook = await prisma.specBook.findFirst({
    where: { bidId },
    orderBy: { uploadedAt: "desc" },
    select: {
      sections: {
        where: { covered: false },
        select: {
          id: true,
          csiNumber: true,
          csiTitle: true,
          csiCanonicalTitle: true,
          aiExtractions: true,
        },
      },
    },
  });

  if (!specBook) return Response.json({ sections: [], total: 0 });

  type Scored = {
    id: number;
    csiNumber: string;
    csiTitle: string;
    csiCanonicalTitle: string | null;
    score: number;
    submittalsCount: number;
  };

  const scored: Scored[] = [];
  for (const s of specBook.sections) {
    const haystack = (s.csiTitle + " " + (s.csiCanonicalTitle ?? "")).toLowerCase();
    const score = tokens.filter((t) => haystack.includes(t)).length;
    if (score === 0) continue;

    let submittalsCount = 0;
    if (s.aiExtractions) {
      try {
        const ai = JSON.parse(s.aiExtractions) as Record<string, unknown>;
        const subs = ai.submittals;
        submittalsCount = Array.isArray(subs) ? subs.length : 0;
      } catch {
        // malformed JSON — treat as no submittals
      }
    }

    scored.push({
      id: s.id,
      csiNumber: s.csiNumber,
      csiTitle: s.csiTitle,
      csiCanonicalTitle: s.csiCanonicalTitle ?? null,
      score,
      submittalsCount,
    });
  }

  scored.sort((a, b) => b.score - a.score || a.csiNumber.localeCompare(b.csiNumber));

  return Response.json({ sections: scored.slice(0, limit), total: scored.length });
}
