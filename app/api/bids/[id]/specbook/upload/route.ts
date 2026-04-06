import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { parseSpecSections, matchSectionThreeState } from "@/lib/documents/specParser";
import { Prisma } from "@prisma/client";
import { generateBidIntelligence } from "@/app/api/bids/[id]/intelligence/generate/route";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

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

    const sections = parseSpecSections(rawText);

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

    return Response.json(
      { ...updated, coveredCount, gapCount: updated._count.sections - coveredCount },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/specbook/upload] parse error:", err);

    await prisma.specBook.update({
      where: { id: specBook.id },
      data: { status: "error" },
    });

    return Response.json({ error: message }, { status: 422 });
  }
}
