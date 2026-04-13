import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import {
  parseDrawingSheets,
  firstSheetByDiscipline,
  DISCIPLINE_TRADE_NAMES,
} from "@/lib/documents/drawingParser";
import { generateBidIntelligence } from "@/app/api/bids/[id]/intelligence/generate/route";
import { generateBidIntelligenceBrief } from "@/lib/services/ai/generateBidIntelligenceBrief";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Valid discipline values for per-discipline uploads
const VALID_DISCIPLINES = [
  "FULLSET",
  "GENERAL",
  "CIVIL",
  "ARCH",
  "STRUCT",
  "MECH",
  "ELEC",
  "PLUMB",
  "INTERIOR",
  "FP",
] as const;

type Discipline = (typeof VALID_DISCIPLINES)[number];

// Map discipline upload tags to the drawing parser's prefix letters
const DISCIPLINE_TO_PREFIX: Record<string, string[]> = {
  GENERAL: ["A"], // General sheets often use A-prefix with low numbers
  CIVIL: ["C"],
  ARCH: ["A"],
  STRUCT: ["S"],
  MECH: ["M"],
  ELEC: ["E"],
  PLUMB: ["P"],
  INTERIOR: ["A"], // Interior often falls under A-prefix
  FP: ["FP"],
  FULLSET: ["A", "S", "M", "P", "E", "C", "FP"],
};

// POST /api/bids/[id]/drawings/upload
// Accepts a drawing PDF with optional discipline tag.
// ?discipline=ARCH uploads as architectural sheets.
// ?discipline=FULLSET (default) uploads as a combined set.
// Re-uploading a discipline replaces only that discipline's upload.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId } });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // Parse discipline from query string
  const url = new URL(request.url);
  const rawDiscipline = (url.searchParams.get("discipline") ?? "FULLSET").toUpperCase();
  if (!VALID_DISCIPLINES.includes(rawDiscipline as Discipline)) {
    return Response.json(
      { error: `Invalid discipline. Must be one of: ${VALID_DISCIPLINES.join(", ")}` },
      { status: 400 }
    );
  }
  const discipline = rawDiscipline as Discipline;

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

  // Delete existing upload for this discipline only (sheets cascade)
  // If uploading FULLSET, also delete all per-discipline uploads (replacing everything)
  // If uploading a discipline, also delete any FULLSET upload (switching modes)
  if (discipline === "FULLSET") {
    await prisma.drawingUpload.deleteMany({ where: { bidId } });
  } else {
    await prisma.drawingUpload.deleteMany({
      where: { bidId, discipline: { in: [discipline, "FULLSET"] } },
    });
  }

  const drawingUpload = await prisma.drawingUpload.create({
    data: { bidId, fileName: file.name, filePath, status: "processing", discipline },
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

    // For per-discipline uploads, use the known discipline prefix mapping
    // For fullset, use all discovered disciplines
    const relevantPrefixes = DISCIPLINE_TO_PREFIX[discipline] ?? [];
    const disciplines =
      discipline === "FULLSET"
        ? Array.from(firstSheet.keys())
        : Array.from(firstSheet.keys()).filter((d) => relevantPrefixes.includes(d));

    // If no disciplines found via parsing, create a single entry for the uploaded discipline
    // This handles PDFs where text extraction can't find sheet numbers
    if (disciplines.length === 0 && discipline !== "FULLSET") {
      const allTrades = await prisma.trade.findMany({ select: { id: true, name: true } });
      const bidTrades = await prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } });
      const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));
      const tradeByName = new Map(allTrades.map((t) => [t.name, t.id]));

      // Map discipline to trades using the parser's mapping
      const prefixes = DISCIPLINE_TO_PREFIX[discipline] ?? [];
      const rows: Array<{
        drawingUploadId: number;
        sheetNumber: string;
        sheetTitle: string | null;
        discipline: string;
        tradeId: number | null;
        matchedTradeId: number | null;
      }> = [];

      for (const prefix of prefixes) {
        const tradeNames = DISCIPLINE_TRADE_NAMES[prefix] ?? [];
        for (const name of tradeNames) {
          const tradeId = tradeByName.get(name) ?? null;
          if (tradeId === null) continue;
          rows.push({
            drawingUploadId: drawingUpload.id,
            sheetNumber: `${prefix}-*`,
            sheetTitle: file.name.replace(/\.pdf$/i, ""),
            discipline: prefix,
            tradeId: bidTradeIds.has(tradeId) ? tradeId : null,
            matchedTradeId: bidTradeIds.has(tradeId) ? null : tradeId,
          });
        }
      }

      if (rows.length > 0) {
        await prisma.drawingSheet.createMany({ data: rows });
      }

      await prisma.drawingUpload.update({
        where: { id: drawingUpload.id },
        data: { status: "ready" },
      });

      const coveredCount = rows.filter((r) => r.tradeId !== null).length;
      const missingCount = rows.filter((r) => r.matchedTradeId !== null).length;

      generateBidIntelligence(bidId).catch((err) =>
        console.error("[drawings/upload] background intelligence generation failed:", err)
      );
      generateBidIntelligenceBrief(bidId, "drawings_upload").catch((err) =>
        console.error("[drawings/upload] background brief generation failed:", err)
      );

      return Response.json(
        { id: drawingUpload.id, discipline, disciplineCount: prefixes.length, sheetCount: 0, coveredCount, missingCount },
        { status: 201 }
      );
    }

    // Standard path: parse found sheets
    const [allTrades, bidTrades] = await Promise.all([
      prisma.trade.findMany({ select: { id: true, name: true } }),
      prisma.bidTrade.findMany({ where: { bidId }, select: { tradeId: true } }),
    ]);
    const bidTradeIds = new Set(bidTrades.map((bt) => bt.tradeId));
    const tradeByName = new Map(allTrades.map((t) => [t.name, t.id]));

    type SheetData = {
      drawingUploadId: number;
      sheetNumber: string;
      sheetTitle: string | null;
      discipline: string;
      tradeId: number | null;
      matchedTradeId: number | null;
    };

    const rows: SheetData[] = [];
    for (const disc of disciplines) {
      const tradeNames = DISCIPLINE_TRADE_NAMES[disc] ?? [];
      const repSheet = firstSheet.get(disc)!;

      for (const name of tradeNames) {
        const tradeId = tradeByName.get(name) ?? null;
        if (tradeId === null) continue;

        rows.push({
          drawingUploadId: drawingUpload.id,
          sheetNumber: repSheet,
          sheetTitle: null,
          discipline: disc,
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

    generateBidIntelligence(bidId).catch((err) =>
      console.error("[drawings/upload] background intelligence generation failed:", err)
    );
    generateBidIntelligenceBrief(bidId, "drawings_upload").catch((err) =>
      console.error("[drawings/upload] background brief generation failed:", err)
    );

    return Response.json(
      {
        id: updated.id,
        discipline,
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
