import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { parseSpecSections, matchSectionToTrade } from "@/lib/documents/specParser";
import { Prisma } from "@prisma/client";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  // Verify bid exists and load its trades for matching
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: { bidTrades: { include: { trade: { select: { id: true, csiCode: true } } } } },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

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

    // Build trade lookup from bid's assigned trades
    const trades = bid.bidTrades.map((bt) => bt.trade);

    // Diagnostic — log sample csiNumbers and trade csiCodes to confirm format alignment
    console.log("[specbook] parsed csiNumbers (first 5):", sections.slice(0, 5).map((s) => JSON.stringify(s.csiNumber)));
    console.log("[specbook] trade csiCodes for this bid:", trades.map((t) => JSON.stringify(t.csiCode)));

    // Create all sections in one batch
    if (sections.length > 0) {
      await prisma.specSection.createMany({
        data: sections.map((s) => {
          const tradeId = matchSectionToTrade(s.csiNumber, trades);
          return {
            specBookId: specBook.id,
            csiNumber: s.csiNumber,
            csiTitle: s.csiTitle,
            rawText: s.rawText,
            tradeId,
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
