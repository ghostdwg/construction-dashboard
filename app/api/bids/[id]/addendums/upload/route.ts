import path from "path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  getBlobStore,
  safeBlobFileName,
  type PutResult,
} from "@/lib/storage/blobStore";
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

  const immutableId = randomUUID();
  const storageKey = addendumStorageKey(
    bidId,
    immutableId,
    safeBlobFileName(file.name),
  );
  const store = getBlobStore();
  let stored: PutResult;
  try {
    stored = await store.put(storageKey, buffer, { contentType: "application/pdf" });
  } catch (err) {
    console.error("[addendums/upload] blob write failed:", err);
    return Response.json({ error: "Storage write failed — file not saved" }, { status: 500 });
  }

  let committed: { id: number; revisionIndex: number | null };
  try {
    let created: typeof committed | null = null;
    for (let attempt = 0; attempt < 3 && !created; attempt += 1) {
      try {
        created = await prisma.$transaction(async (tx) => {
          const [active, latest] = await Promise.all([
            tx.addendumUpload.findFirst({
              where: { bidId, addendumNumber, activeSlot: 1 },
              select: { id: true, revisionIndex: true },
            }),
            tx.addendumUpload.findFirst({
              where: { bidId, addendumNumber },
              orderBy: [{ revisionIndex: "desc" }, { uploadedAt: "desc" }, { id: "desc" }],
              select: { id: true, revisionIndex: true },
            }),
          ]);
          const prior = active ?? latest;
          const revisionIndex = (latest?.revisionIndex ?? 0) + 1;
          if (prior) {
            await tx.addendumUpload.update({
              where: { id: prior.id },
              data: {
                revisionIndex: prior.revisionIndex ?? 0,
                effectiveState: "SUPERSEDED",
                activeSlot: null,
              },
            });
          }
          const appended = await tx.addendumUpload.create({
            data: {
              bidId,
              addendumNumber,
              addendumDate,
              fileName: file.name,
              storageKey,
              status: "ready",
              extractedText: extractedText.trim(),
              revisionIndex,
              effectiveState: "EFFECTIVE",
              supersedesAddendumId: prior?.id ?? null,
              sha256: stored.sha256,
              byteSize: stored.size,
              mimeType: stored.contentType ?? "application/pdf",
              immutableId,
              activeSlot: 1,
            },
            select: { id: true, revisionIndex: true },
          });
          await tx.bidIntelligenceBrief.updateMany({
            where: { bidId },
            data: { isStale: true },
          });
          return appended;
        });
      } catch (error) {
        const conflict =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === "P2002";
        if (!conflict || attempt === 2) throw error;
      }
    }
    if (!created) throw new Error("Addendum revision allocation failed");
    committed = created;
  } catch (err) {
    await deleteAddendumStorageIfUnreferenced(storageKey, bidId).catch(() => undefined);
    console.error("[addendums/upload] database revision append failed:", err);
    return Response.json(
      { error: "Addendum could not be recorded — upload rolled back" },
      { status: 500 },
    );
  }

  return Response.json(
    {
      id: committed.id,
      addendumNumber,
      fileName: file.name,
      status: "ready",
      revisionIndex: committed.revisionIndex,
      sha256: stored.sha256,
      byteSize: stored.size,
    },
    { status: 201 },
  );
}
