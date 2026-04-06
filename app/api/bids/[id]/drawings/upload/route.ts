import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import {
  parseDrawingSheets,
  firstSheetByDiscipline,
  DISCIPLINE_TRADE_NAMES,
} from "@/lib/documents/drawingParser";
import { generateBidIntelligence } from "@/app/api/bids/[id]/intelligence/generate/route";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// POST /api/bids/[id]/drawings/upload
// Accepts a drawing sheet index PDF.
// Parses discipline sheet numbers, maps each discipline to trades,
// and creates one DrawingSheet record per (discipline, trade) pair.
// Three-state logic: tradeId set = on bid (covered), matchedTradeId set = in
// dictionary but not on bid (missing), both null = unknown.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
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

  // Save to disk
  const dir = path.join(process.cwd(), "uploads", "drawings", String(bidId));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  // Delete any existing drawing upload for this bid (sheets cascade)
  await prisma.drawingUpload.deleteMany({ where: { bidId } });

  const drawingUpload = await prisma.drawingUpload.create({
    data: { bidId, fileName: file.name, filePath, status: "processing" },
  });

  try {
    // Extract text with pdfjs-dist
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

    const sheets = parseDrawingSheets(rawText);
    const firstSheet = firstSheetByDiscipline(sheets);

    // Unique disciplines found
    const disciplines = Array.from(firstSheet.keys());

    if (disciplines.length === 0) {
      await prisma.drawingUpload.update({
        where: { id: drawingUpload.id },
        data: { status: "ready" },
      });
      return Response.json(
        { id: drawingUpload.id, disciplineCount: 0, sheetCount: sheets.length },
        { status: 201 }
      );
    }

    // Load all trades + bid trade ids
    const [allTrades, bidTrades] = await Promise.all([
      prisma.trade.findMany({ select: { id: true, name: true } }),
      prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
    ]);
    const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));
    const tradeByName = new Map(allTrades.map((t) => [t.name, t.id]));

    // Build DrawingSheet records: one per (discipline, trade) pair
    type SheetData = {
      drawingUploadId: number;
      sheetNumber: string;
      sheetTitle: string | null;
      discipline: string;
      tradeId: number | null;
      matchedTradeId: number | null;
    };

    const rows: SheetData[] = [];
    for (const discipline of disciplines) {
      const tradeNames = DISCIPLINE_TRADE_NAMES[discipline] ?? [];
      const repSheet = firstSheet.get(discipline)!;

      for (const name of tradeNames) {
        const tradeId = tradeByName.get(name) ?? null;
        if (tradeId === null) continue; // trade not in dictionary

        rows.push({
          drawingUploadId: drawingUpload.id,
          sheetNumber: repSheet,
          sheetTitle: null,
          discipline,
          tradeId: bidTradeIds.has(tradeId) ? tradeId : null,
          matchedTradeId: bidTradeIds.has(tradeId) ? null : tradeId,
        });
      }
    }

    if (rows.length > 0) {
      await prisma.drawingSheet.createMany({ data: rows });
    }

    const updated = await prisma.drawingUpload.update({
      where: { id: drawingUpload.id },
      data: { status: "ready" },
    });

    const coveredCount = rows.filter((r) => r.tradeId !== null).length;
    const missingCount = rows.filter((r) => r.matchedTradeId !== null).length;

    // Fire-and-forget intelligence regeneration — does not block upload response
    generateBidIntelligence(bidId).catch((err) =>
      console.error("[drawings/upload] background intelligence generation failed:", err)
    );

    return Response.json(
      {
        id: updated.id,
        disciplineCount: disciplines.length,
        sheetCount: sheets.length,
        coveredCount,
        missingCount,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/drawings/upload] parse error:", err);
    await prisma.drawingUpload.update({
      where: { id: drawingUpload.id },
      data: { status: "error" },
    });
    return Response.json({ error: message }, { status: 422 });
  }
}
