import path from "path";
import fs from "fs/promises";
import { prisma } from "@/lib/prisma";
import { lookupCanonicalTitles } from "@/lib/services/csi/canonicalTitle";

// POST /api/bids/[id]/specbook/split
//
// Takes the already-uploaded spec book and splits it into per-section PDFs
// using the sidecar. Each section gets its own PDF file + SpecSection record
// is updated with pdfPath, pageStart, pageEnd, pageCount.
//
// This is a separate step after upload — replaces the regex-parsed sections
// with accurate page-range-based sections (Procore-style).

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
  });

  if (!specBook) {
    return Response.json({ error: "No spec book uploaded" }, { status: 404 });
  }

  // Verify the source PDF exists
  try {
    await fs.access(specBook.filePath);
  } catch {
    return Response.json({ error: "Spec book file not found on disk" }, { status: 404 });
  }

  // Create output dir for split sections
  const outputDir = path.join(
    process.cwd(),
    "uploads",
    "specbooks",
    String(bidId),
    "sections",
  );
  await fs.mkdir(outputDir, { recursive: true });

  // Call sidecar split endpoint
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    const res = await fetch(`${SIDECAR_URL}/parse/specs/split`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        pdf_path: specBook.filePath,
        output_dir: outputDir,
      }),
      signal: AbortSignal.timeout(300_000), // 5 min for split
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: `Sidecar returned ${res.status}` }));
      return Response.json({ error: err.detail ?? "Split failed" }, { status: res.status });
    }

    const data = (await res.json()) as {
      sections: Array<{
        csi: string;
        title: string;
        pdf_path: string;
        filename: string;
        page_start: number;
        page_end: number;
        page_count: number;
        text: string;
      }>;
      section_count: number;
    };

    console.log(`[specbook/split] split into ${data.section_count} sections`);

    // Load trades for three-state matching
    const [allTrades, bidTrades] = await Promise.all([
      prisma.trade.findMany({ select: { id: true, csiCode: true } }),
      prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
    ]);
    const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));

    function matchTrade(csi: string): { tradeId: number | null; matchedTradeId: number | null } {
      const digits = csi.replace(/\D/g, "");
      if (!digits) return { tradeId: null, matchedTradeId: null };
      for (const t of allTrades) {
        if (!t.csiCode) continue;
        if (t.csiCode.replace(/\D/g, "") === digits) {
          return bidTradeIds.has(t.id)
            ? { tradeId: t.id, matchedTradeId: null }
            : { tradeId: null, matchedTradeId: t.id };
        }
      }
      return { tradeId: null, matchedTradeId: null };
    }

    // Enrich with canonical MasterFormat titles (safe lookup — only accepts
    // matches where the doc title overlaps with the canonical title)
    const canonicalMap = await lookupCanonicalTitles(
      data.sections.map((s) => ({ csiNumber: s.csi, docTitle: s.title }))
    );

    // Delete all existing sections (they're regex-parsed junk) and replace
    // with the properly-split ones
    await prisma.specSection.deleteMany({
      where: { specBookId: specBook.id },
    });

    // Create new sections with pdfPath + page ranges + canonical titles
    const created = await prisma.specSection.createMany({
      data: data.sections.map((s) => {
        const match = matchTrade(s.csi);
        return {
          specBookId: specBook.id,
          csiNumber: s.csi,
          csiTitle: s.title,
          csiCanonicalTitle: canonicalMap.get(s.csi.trim()) ?? null,
          rawText: s.text.slice(0, 10000),
          source: "split_pdf",
          tradeId: match.tradeId,
          matchedTradeId: match.matchedTradeId,
          covered: match.tradeId !== null,
          pdfPath: s.pdf_path,
          pdfFileName: s.filename,
          pageStart: s.page_start,
          pageEnd: s.page_end,
          pageCount: s.page_count,
        };
      }),
    });

    return Response.json({
      success: true,
      sectionsCreated: created.count,
      sectionCount: data.section_count,
      canonicalMatches: canonicalMap.size,
    });
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = raw === "fetch failed"
      ? "Sidecar unavailable — make sure the Python service is running (`npm run dev:sidecar`)"
      : raw;
    console.error("[specbook/split] error:", err);
    return Response.json({ error: message }, { status: 422 });
  }
}
