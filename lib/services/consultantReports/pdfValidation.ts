// lib/services/consultantReports/pdfValidation.ts
//
// Module OPS3 (Phase 1A) — upload validation for consultant-report PDFs.
// BOTH checks are required, not optional: the declared MIME type must be
// application/pdf AND the first bytes must be the %PDF- magic marker. A
// MIME allowlist alone is insufficient for this file class — the client
// controls the declared type, only the bytes tell the truth. 25 MiB cap,
// enforced before hashing. Pure functions: no blob access, no schema.

export const CONSULTANT_REPORT_MIME = "application/pdf";
export const CONSULTANT_REPORT_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const PDF_MAGIC = Buffer.from("%PDF-", "ascii");

export type ConsultantPdfValidation = { ok: true } | { ok: false; error: string };

export function validateConsultantReportUpload(input: {
  mimeType: string;
  bytes: Buffer;
}): ConsultantPdfValidation {
  if (input.mimeType !== CONSULTANT_REPORT_MIME) {
    return {
      ok: false,
      error: `Unsupported file type "${input.mimeType}" — consultant reports must be application/pdf`,
    };
  }
  if (input.bytes.byteLength <= 0) {
    return { ok: false, error: "Upload is empty" };
  }
  if (input.bytes.byteLength > CONSULTANT_REPORT_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `File is too large (${input.bytes.byteLength} bytes; max ${CONSULTANT_REPORT_MAX_UPLOAD_BYTES})`,
    };
  }
  if (
    input.bytes.byteLength < PDF_MAGIC.byteLength ||
    !input.bytes.subarray(0, PDF_MAGIC.byteLength).equals(PDF_MAGIC)
  ) {
    return {
      ok: false,
      error: "File is not a PDF (missing %PDF- signature)",
    };
  }
  return { ok: true };
}
