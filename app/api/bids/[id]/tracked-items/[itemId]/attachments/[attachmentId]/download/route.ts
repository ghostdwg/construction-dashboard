// OPS private file serving V0 — authenticated download of ONE tracked-item
// attachment.
//
// GET …/tracked-items/[itemId]/attachments/[attachmentId]/download
//
// Security order (each step before the next; blob is read LAST):
//   1. session wall (proxy.ts — same as every bid route);
//   2. tracked item must belong to THIS bid (404 otherwise);
//   3. attachment must belong to THAT item (404 otherwise);
//   4. only then is the blob read — by the SERVER-STORED storageKey. The
//      client supplies ids only; no request parameter can name a storage key.
// Headers: attachment disposition with sanitized name, allowlisted
// Content-Type (else octet-stream), nosniff, private/no-store (see
// lib/services/storage/downloadHeaders.ts). A metadata row whose blob is
// missing returns an honest 404 — never a fabricated body.

import { prisma } from "@/lib/prisma";
import { getBlobStore } from "@/lib/storage/blobStore";
import { privateDownloadHeaders } from "@/lib/services/storage/downloadHeaders";

export async function GET(
  _request: Request,
  {
    params,
  }: { params: Promise<{ id: string; itemId: string; attachmentId: string }> }
) {
  const { id, itemId, attachmentId } = await params;
  const bidId = parseInt(id, 10);
  const tid = parseInt(itemId, 10);
  const aid = parseInt(attachmentId, 10);
  if (isNaN(bidId) || isNaN(tid) || isNaN(aid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const item = await prisma.trackedItem.findFirst({
    where: { id: tid, bidId },
    select: { id: true },
  });
  if (!item) return Response.json({ error: "Not found" }, { status: 404 });

  const attachment = await prisma.trackedItemAttachment.findFirst({
    where: { id: aid, trackedItemId: tid },
    select: { storageKey: true, fileName: true, mimeType: true, byteSize: true },
  });
  if (!attachment) return Response.json({ error: "Not found" }, { status: 404 });

  let buffer: Buffer;
  try {
    buffer = await getBlobStore().get(attachment.storageKey);
  } catch (err) {
    console.error(
      "[tracked-items] attachment blob missing/unreadable for metadata row:",
      err instanceof Error ? err.message : err
    );
    return Response.json(
      { error: "File is missing from storage" },
      { status: 404 }
    );
  }

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: privateDownloadHeaders({
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      byteSize: buffer.byteLength,
    }),
  });
}
