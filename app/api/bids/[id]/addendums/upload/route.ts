import path from "path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore, safeBlobFileName } from "@/lib/storage/blobStore";
import { addendumStorageKey } from "@/lib/services/addendums/storagePath";
import { deleteAddendumStorageIfUnreferenced } from "@/lib/services/storage/referenceSafety";

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

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

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
  if (addendumDate && isNaN(addendumDate.getTime())) {
    return Response.json({ error: "addendumDate must be a valid date" }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase();
  if (file.type !== "application/pdf" && ext !== ".pdf") {
    return Response.json({ error: "Only PDF files are accepted" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extractedText = "";
  try {
    const loadingTask = getDocument({ data: new Uint8Array(buffer) });
    const pdfDoc = await loadingTask.promise;
    for (let i = 1; i <= pdfDoc.numPages; i += 1) {
      const page = await pdfDoc.getPage(i);
      const content = await page.getTextContent();
      extractedText +=
        content.items
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((item: any) => ("str" in item ? item.str : ""))
          .join(" ") + "\n";
    }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[POST /api/bids/:id/addendums/upload] parse error:", err);
    return Response.json({ error: message }, { status: 422 });
  }

  const storageKey = addendumStorageKey(
    bidId,
    randomUUID(),
    safeBlobFileName(file.name),
  );
  const store = getBlobStore();
  try {
    await store.put(storageKey, buffer, { contentType: "application/pdf" });
  } catch (err) {
    console.error("[addendums/upload] blob write failed:", err);
    return Response.json({ error: "Storage write failed — file not saved" }, { status: 500 });
  }

  let committed: { id: number; superseded: Array<{ storageKey: string | null }> };
  try {
    committed = await prisma.$transaction(async (tx) => {
      const superseded = await tx.addendumUpload.findMany({
        where: { bidId, addendumNumber },
        select: { storageKey: true },
      });
      const created = await tx.addendumUpload.create({
        data: {
          bidId,
          addendumNumber,
          addendumDate,
          fileName: file.name,
          storageKey,
          status: "ready",
          extractedText: extractedText.trim(),
        },
      });
      await tx.addendumUpload.deleteMany({
        where: { bidId, addendumNumber, id: { not: created.id } },
      });
      await tx.bidIntelligenceBrief.updateMany({
        where: { bidId },
        data: { isStale: true },
      });
      return { id: created.id, superseded };
    });
  } catch (err) {
    await deleteAddendumStorageIfUnreferenced(storageKey, bidId).catch(() => undefined);
    console.error("[addendums/upload] database replacement failed:", err);
    return Response.json(
      { error: "Addendum could not be recorded — upload rolled back" },
      { status: 500 },
    );
  }

  await Promise.all(
    Array.from(
      new Set(
        committed.superseded
          .map((row) => row.storageKey)
          .filter((value): value is string => value !== null),
      ),
    ).map((oldRef) =>
      deleteAddendumStorageIfUnreferenced(oldRef, bidId).catch((err) =>
        console.error("[addendums/upload] superseded blob cleanup failed:", err),
      ),
    ),
  );

  return Response.json(
    {
      id: committed.id,
      addendumNumber,
      fileName: file.name,
      status: "ready",
    },
    { status: 201 },
  );
}
