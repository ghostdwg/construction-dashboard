// Module OPS2 (Slice 2) — Field Report source-file upload.
//
// POST …/field-reports/[fieldReportId]/upload   multipart: file (required)
//
// Ordering contract: (1) authorization and bid/report/reference preflight
// before body or blob work; (2) blob put, guarded; (3) transactionally claim
// the exact preflight pointer while there are still no durable references,
// record metadata/provenance, and audit; (4) compensate only the newly
// written unreferenced blob on a lost claim; (5) retire the old blob only
// after a successful claim proves it was unreferenced. MIME allowlist
// pdf/jpeg/png/webp; 25 MiB cap; NO OCR, NO AI
// extraction, NO auto-created items — parseStatus stays UNPARSED.

import { getBlobStore } from "@/lib/storage/blobStore";
import { randomUUID } from "node:crypto";
import { requireBidAccess } from "@/lib/auth-helpers";
import {
  FIELD_REPORT_FILE_CONCURRENT_ERROR,
  FIELD_REPORT_FILE_REFERENCED_ERROR,
  getFieldReportFileMutationState,
  recordReportFile,
} from "@/lib/services/fieldReports";
import {
  fieldReportStorageKey,
  validateFieldReportUpload,
} from "@/lib/services/fieldReports/storagePath";

function mutationErrorStatus(error: string): number {
  if (error === "Not found") return 404;
  if (error === FIELD_REPORT_FILE_REFERENCED_ERROR || error === FIELD_REPORT_FILE_CONCURRENT_ERROR) return 409;
  return 400;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; fieldReportId: string }> }
) {
  const { id, fieldReportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(fieldReportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  // Bid tenancy and the evidence freeze precede body parsing and byte work.
  // recordReportFile repeats both checks in its authoritative transaction.
  const mutationState = await getFieldReportFileMutationState(bidId, rid);
  if (!mutationState.ok) {
    return Response.json({ error: mutationState.error }, { status: mutationErrorStatus(mutationState.error) });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "multipart/form-data body required" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || !("name" in file)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }
  const fileName = String((file as File).name || "upload.bin");
  const buffer = Buffer.from(await file.arrayBuffer());

  const validation = validateFieldReportUpload({
    fileName,
    mimeType: file.type || "application/octet-stream",
    byteSize: buffer.byteLength,
  });
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

  const storageKey = fieldReportStorageKey(
    bidId,
    rid,
    randomUUID(),
    validation.safeFileName,
  );
  const store = getBlobStore();

  // (2) bytes, guarded.
  try {
    await store.put(storageKey, buffer, { contentType: file.type });
  } catch (err) {
    console.error("[field-reports] source-file blob write failed:", err);
    return Response.json(
      { error: "Storage write failed — file not saved" },
      { status: 500 }
    );
  }

  // (3) metadata after bytes; (4) clean the new blob if metadata fails.
  let result: Awaited<ReturnType<typeof recordReportFile>>;
  try {
    result = await recordReportFile(bidId, rid, {
      storageKey,
      expectedStorageKey: mutationState.value.expectedStorageKey,
      fileName: validation.safeFileName,
      mimeType: file.type,
      byteSize: buffer.byteLength,
    }, access.user);
  } catch (err) {
    await store.delete(storageKey).catch((cleanupErr) => {
      console.error(
        "[field-reports] blob cleanup after metadata failure also failed — orphan blob at",
        storageKey,
        cleanupErr
      );
    });
    console.error("[field-reports] file metadata write failed (blob cleaned up):", err);
    return Response.json(
      { error: "File could not be recorded — upload rolled back" },
      { status: 500 }
    );
  }
  if (!result.ok) {
    await store.delete(storageKey).catch(() => {});
    const status = mutationErrorStatus(result.error);
    return Response.json({ error: result.error }, { status });
  }

  // Re-upload housekeeping: remove the superseded blob (different key only).
  if (result.value.previousStorageKey) {
    await store.delete(result.value.previousStorageKey).catch((err) => {
      console.error(
        "[field-reports] unreferenced superseded blob cleanup failed " +
          "(metadata already points at the new file):",
        result.value.previousStorageKey,
        err
      );
    });
  }

  return Response.json({ ok: true, fileRecorded: true }, { status: 201 });
}
