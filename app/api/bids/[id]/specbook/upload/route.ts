import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { parseSpecSections, matchSectionThreeState } from "@/lib/documents/specParser";
import { generateBidIntelligence } from "@/app/api/bids/[id]/intelligence/generate/route";
import { generateBidIntelligenceBrief } from "@/lib/services/ai/generateBidIntelligenceBrief";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// ── Sidecar integration ────────────────────────────────────────────────────

const SIDECAR_URL = process.env.SIDECAR_URL || "http://127.0.0.1:8001";
const SIDECAR_API_KEY = process.env.SIDECAR_API_KEY || "";

type SidecarSection = {
  // Standard parser fields
  section_number: string;
  title: string;
  raw_text: string;
  page_start: number;
  page_end: number;
  table_count: number;
  page_count: number;
  // Intelligent pipeline fields
  csi?: string;
  analysis?: Record<string, unknown>;
  ai_extractions?: Record<string, unknown>;
};

async function parsePdfViaSidecar(
  buffer: Buffer,
  fileName: string,
): Promise<{ sections: SidecarSection[]; aiCostUsd?: number } | null> {
  try {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/pdf" }), fileName);

    const headers: Record<string, string> = {};
    if (SIDECAR_API_KEY) headers["X-API-Key"] = SIDECAR_API_KEY;

    // Upload always uses fast parse — AI analysis is a separate step
    const res = await fetch(`${SIDECAR_URL}/parse/specs`, {
      method: "POST",
      body: form,
      headers,
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      console.warn(`[specbook/upload] sidecar returned ${res.status}, falling back to pdfjs-dist`);
      return null;
    }

    const data = await res.json() as { sections: SidecarSection[] };

    return {
      sections: data.sections,
      aiCostUsd: undefined,
    };
  } catch (err) {
    console.warn("[specbook/upload] sidecar unavailable, falling back to pdfjs-dist:", err);
    return null;
  }
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  // AI analysis is now a separate step — see /api/bids/[id]/specbook/analyze

  // Verify bid exists
  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // Load all trades in dictionary + bid's assigned trade ids
  const [allTrades, bidTrades] = await Promise.all([
    prisma.trade.findMany({ select: { id: true, csiCode: true } }),
    prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
  ]);
  const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (file.type !== "application/pdf" && ext !== ".pdf") {
    return Response.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }

  // Save file to disk
  const dir = path.join(process.cwd(), "uploads", "specbooks", String(bidId));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  // Delete any existing spec book for this bid (sections cascade via onDelete: Cascade)
  await prisma.specBook.deleteMany({ where: { bidId } });

  // Create SpecBook record as processing
  const specBook = await prisma.specBook.create({
    data: { bidId, fileName: file.name, filePath, status: "processing" },
  });

  // Extract text and parse sections
  try {
    // Try sidecar first (PyMuPDF4LLM — handles large files, better table extraction)
    const sidecarResult = await parsePdfViaSidecar(buffer, file.name);

    let sections: Array<{ csiNumber: string; csiTitle: string; rawText: string; aiExtractions?: string }>;

    if (sidecarResult && sidecarResult.sections.length > 0) {
      console.log(`[specbook/upload] sidecar parsed ${sidecarResult.sections.length} sections`);
      sections = sidecarResult.sections.map((s) => ({
        csiNumber: s.section_number || s.csi || "",
        csiTitle: s.title,
        rawText: s.raw_text,
      }));
    } else {
      // Fallback: pdfjs-dist (in-process, may struggle with large files)
      console.log("[specbook/upload] using pdfjs-dist fallback");
      const loadingTask = getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;
      let rawText = "";
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        rawText +=
          content.items
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map((item: any) => ("str" in item ? item.str : ""))
            .join(" ") + "\n";
      }
      sections = parseSpecSections(rawText);
    }

    // Create all sections in one batch using three-state matching
    if (sections.length > 0) {
      await prisma.specSection.createMany({
        data: sections.map((s) => {
          const { tradeId, matchedTradeId } = matchSectionThreeState(
            s.csiNumber,
            allTrades,
            bidTradeIds
          );
          return {
            specBookId: specBook.id,
            csiNumber: s.csiNumber,
            csiTitle: s.csiTitle,
            rawText: s.rawText,
            source: "specbook",
            tradeId,
            matchedTradeId,
            covered: tradeId !== null,
            aiExtractions: s.aiExtractions ?? null,
          };
        }),
      });
    }

    const updated = await prisma.specBook.update({
      where: { id: specBook.id },
      data: { status: "ready" },
      include: { _count: { select: { sections: true } } },
    });

    const coveredCount = await prisma.specSection.count({
      where: { specBookId: specBook.id, covered: true },
    });

    // Fire-and-forget intelligence regeneration — does not block upload response
    generateBidIntelligence(bidId).catch((err) =>
      console.error("[specbook/upload] background intelligence generation failed:", err)
    );
    generateBidIntelligenceBrief(bidId, "specbook_upload").catch((err) =>
      console.error("[specbook/upload] background brief generation failed:", err)
    );

    return Response.json(
      { ...updated, coveredCount, gapCount: updated._count.sections - coveredCount },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/specbook/upload] parse error:", err);

    // Mark as error — may fail if a concurrent upload already deleted this record
    try {
      await prisma.specBook.update({
        where: { id: specBook.id },
        data: { status: "error" },
      });
    } catch {
      // Record already gone (concurrent upload replaced it) — ignore
    }

    return Response.json({ error: message }, { status: 422 });
  }
}
