// Module OPS2 (Slice 2) — Field Report source-file upload.
//
// POST …/field-reports/[fieldReportId]/upload   multipart: file (required)
//
// Slice 1 ordering contract, verbatim: (1) bid/report tenancy BEFORE any
// byte is written; (2) blob put, guarded — storage failure returns 500 and
// records NO metadata; (3) metadata only after the blob landed; (4) blob is
// best-effort deleted if the metadata write fails. Re-upload replaces the
// report's file metadata and cleans up the previous blob when its key
// differs. MIME allowlist pdf/jpeg/png/webp; 25 MiB cap; NO OCR, NO AI
// extraction, NO auto-created items — parseStatus stays UNPARSED.

import { getBlobStore } from "@/lib/storage/blobStore";
import {
  fieldReportExists,
  recordReportFile,
} from "@/lib/services/fieldReports";
import {
  fieldReportStorageKey,
  validateFieldReportUpload,
} from "@/lib/services/fieldReports/storagePath";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; fieldReportId: string }> }
) {
  const { id, fieldReportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(fieldReportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

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

  // (1) tenancy before bytes — a blob can never land for another bid's report.
  const exists = await fieldReportExists(bidId, rid);
  if (!exists) return Response.json({ error: "Not found" }, { status: 404 });

  const storageKey = fieldReportStorageKey(bidId, rid, validation.safeFileName);
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
      fileName: validation.safeFileName,
      mimeType: file.type,
      byteSize: buffer.byteLength,
    });
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
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }

  // Re-upload housekeeping: remove the superseded blob (different key only).
  if (result.value.previousStorageKey) {
    await store.delete(result.value.previousStorageKey).catch((err) => {
      console.error(
        "[field-reports] superseded blob cleanup failed (metadata already points at the new file):",
        result.value.previousStorageKey,
        err
      );
    });
  }

  return Response.json({ ok: true, fileRecorded: true }, { status: 201 });
}
