import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// POST /api/bids/[id]/addendums/upload
// Fields: file (PDF), addendumNumber (Int), addendumDate (optional ISO date string)
// Extracts text with pdfjs-dist, stores AddendumUpload record.
// Marks existing BidIntelligenceBrief as stale.
// Delta generation is a separate explicit action via POST /addendums/[id]/delta.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({ where: { id: bidId }, select: { id: true } });
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

  const addendumNumberRaw = formData.get("addendumNumber");
  const addendumNumber = parseInt(String(addendumNumberRaw ?? ""), 10);
  if (isNaN(addendumNumber) || addendumNumber < 1) {
    return Response.json({ error: "addendumNumber must be a positive integer" }, { status: 400 });
  }

  const addendumDateRaw = formData.get("addendumDate");
  const addendumDate =
    addendumDateRaw && String(addendumDateRaw).trim()
      ? new Date(String(addendumDateRaw))
      : null;

  const ext = path.extname(file.name).toLowerCase();
  if (file.type !== "application/pdf" && ext !== ".pdf") {
    return Response.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }

  // Save to disk
  const dir = path.join(process.cwd(), "uploads", "addendums", String(bidId));
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buffer);

  // Create record as processing
  const record = await prisma.addendumUpload.create({
    data: {
      bidId,
      addendumNumber,
      addendumDate,
      fileName: file.name,
      status: "processing",
    },
  });

  try {
    // Extract text with pdfjs-dist
    const loadingTask = getDocument({ data: new Uint8Array(buffer) });
    const pdfDoc = await loadingTask.promise;
    let extractedText = "";
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      extractedText +=
        content.items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ") + "\n";
    }

    await prisma.addendumUpload.update({
      where: { id: record.id },
      data: { status: "ready", extractedText: extractedText.trim() },
    });

    // Mark existing brief as stale — delta processing is the explicit next step
    await prisma.bidIntelligenceBrief.updateMany({
      where: { bidId },
      data: { isStale: true },
    });

    return Response.json(
      {
        id: record.id,
        addendumNumber,
        fileName: file.name,
        status: "ready",
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/addendums/upload] parse error:", err);
    await prisma.addendumUpload.update({
      where: { id: record.id },
      data: { status: "error" },
    });
    return Response.json({ error: message }, { status: 422 });
  }
}
