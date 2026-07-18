import { safeBlobFileName } from "@/lib/storage/blobStore";
import { randomUUID } from "node:crypto";

export const RESPONSE_ATTACHMENT_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);
export const RESPONSE_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

export function responseAttachmentStorageKey(
  bidId: number,
  packageId: number,
  revisionId: number,
  fileName: string,
  nonce: string = randomUUID()
): string {
  return `plan-room/jobs/${bidId}/response-packages/${packageId}/${revisionId}-${nonce}-${safeBlobFileName(fileName)}`;
}

export function validateResponseAttachment(input: {
  fileName: string;
  mimeType: string;
  byteSize: number;
}): { ok: true; safeFileName: string } | { ok: false; error: string } {
  if (!RESPONSE_ATTACHMENT_MIME.has(input.mimeType)) {
    return { ok: false, error: "Unsupported attachment type" };
  }
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize <= 0) {
    return { ok: false, error: "Attachment is empty" };
  }
  if (input.byteSize > RESPONSE_ATTACHMENT_MAX_BYTES) {
    return { ok: false, error: "Attachment exceeds 25 MiB" };
  }
  return { ok: true, safeFileName: safeBlobFileName(input.fileName) };
}
