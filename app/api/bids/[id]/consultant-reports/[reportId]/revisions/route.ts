// Module OPS3 (Phase 1A) — corrected-file upload for an EXISTING report.
//
// POST …/consultant-reports/[reportId]/revisions   multipart: file (+ replacementReason)
//
// Same report identity, new immutable revision row: supersedesRevisionId is
// set once to the previous latest revision; BOTH files stay downloadable
// forever (the superseded one is badged in the UI, never removed). A later
// periodic report (new number/date) is a NEW report via the collection
// route — never a revision. Same validation gate as the original upload:
// application/pdf MIME AND %PDF- magic bytes, 25 MiB cap, sha-256
// duplicate check before any store.

import { auth } from "@/lib/auth";
import { requireBidAccess } from "@/lib/auth-helpers";
import { getBlobStore } from "@/lib/storage/blobStore";
import { uploadCorrectedRevision } from "@/lib/services/consultantReports";
import {
  CONSULTANT_REPORT_MAX_UPLOAD_BYTES,
  validateConsultantReportUpload,
} from "@/lib/services/consultantReports/pdfValidation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; reportId: string }> }
) {
  const { id, reportId } = await params;
  const bidId = parseInt(id, 10);
  const rid = parseInt(reportId, 10);
  if (isNaN(bidId) || isNaN(rid))
    return Response.json({ error: "Invalid id" }, { status: 400 });

  const access = await requireBidAccess(bidId);
  if (!access.ok) return access.response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "multipart/form-data body required" },
      { status: 400 }
    );
  }
  const file = form.get("file");
  if (!(file instanceof Blob) || !("name" in file)) {
    return Response.json({ error: "file is required" }, { status: 400 });
  }
  const originalFilename = String((file as File).name || "report.pdf");
  const mimeType = file.type || "application/octet-stream";

  // Size gate BEFORE buffering (Codex blocker 2): reject on the Blob's own
  // size so an oversized upload never allocates a 25 MiB+ buffer. The
  // validator re-checks the real byte length after read (defense in depth).
  if (file.size > CONSULTANT_REPORT_MAX_UPLOAD_BYTES) {
    return Response.json(
      {
        error: `File is too large (${file.size} bytes; max ${CONSULTANT_REPORT_MAX_UPLOAD_BYTES})`,
      },
      { status: 400 }
    );
  }
  const bytes = Buffer.from(await file.arrayBuffer());

  const validation = validateConsultantReportUpload({ mimeType, bytes });
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });

  const reasonRaw = form.get("replacementReason");
  const replacementReason =
    typeof reasonRaw === "string" && reasonRaw.trim() ? reasonRaw.trim() : null;

  const session = await auth().catch(() => null);
  const user = session?.user as { name?: string | null; email?: string | null } | undefined;
  const store = getBlobStore();

  const result = await uploadCorrectedRevision(
    bidId,
    rid,
    { originalFilename, mimeType, bytes, replacementReason },
    { name: user?.name ?? null, email: user?.email ?? null },
    async (key, buf) => {
      await store.put(key, buf, { contentType: mimeType });
    }
  );

  if (!result.ok) {
    const status = result.error === "Not found" ? 404 : 400;
    return Response.json({ error: result.error }, { status });
  }
  const isDuplicate = result.value.kind === "duplicate";
  return Response.json(
    {
      ok: true,
      duplicate: isDuplicate,
      reportId: result.value.reportId,
      revisionId: result.value.revisionId,
    },
    { status: isDuplicate ? 200 : 201 }
  );
}
