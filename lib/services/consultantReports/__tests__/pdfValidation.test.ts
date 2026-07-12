// Module OPS3 (Phase 1A) — PDF upload validation. The Codex-mandated check:
// MIME alone is NEVER enough; the %PDF- magic bytes are required too.
import { describe, expect, test } from "vitest";

import {
  CONSULTANT_REPORT_MAX_UPLOAD_BYTES,
  validateConsultantReportUpload,
} from "../pdfValidation";

const pdf = (body = "fake pdf body") => Buffer.from(`%PDF-1.7\n${body}`, "ascii");

describe("validateConsultantReportUpload", () => {
  test("accepts a well-formed PDF", () => {
    const result = validateConsultantReportUpload({
      mimeType: "application/pdf",
      bytes: pdf(),
    });
    expect(result).toEqual({ ok: true });
  });

  test("rejects a non-pdf MIME type even with valid magic bytes", () => {
    const result = validateConsultantReportUpload({
      mimeType: "image/png",
      bytes: pdf(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/application\/pdf/);
  });

  test("rejects correct MIME with WRONG magic bytes (the Codex-mandated case)", () => {
    const result = validateConsultantReportUpload({
      mimeType: "application/pdf",
      bytes: Buffer.from("MZ\x90\x00 definitely-not-a-pdf", "ascii"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/%PDF-/);
  });

  test("rejects an empty upload", () => {
    const result = validateConsultantReportUpload({
      mimeType: "application/pdf",
      bytes: Buffer.alloc(0),
    });
    expect(result.ok).toBe(false);
  });

  test("rejects a file shorter than the magic marker", () => {
    const result = validateConsultantReportUpload({
      mimeType: "application/pdf",
      bytes: Buffer.from("%PD", "ascii"),
    });
    expect(result.ok).toBe(false);
  });

  test("rejects an oversized upload (>25 MiB) before any further processing", () => {
    const big = Buffer.alloc(CONSULTANT_REPORT_MAX_UPLOAD_BYTES + 1, 0x20);
    big.write("%PDF-", 0, "ascii");
    const result = validateConsultantReportUpload({
      mimeType: "application/pdf",
      bytes: big,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/too large/);
  });

  test("accepts a file at exactly the 25 MiB cap", () => {
    const atCap = Buffer.alloc(CONSULTANT_REPORT_MAX_UPLOAD_BYTES, 0x20);
    atCap.write("%PDF-", 0, "ascii");
    const result = validateConsultantReportUpload({
      mimeType: "application/pdf",
      bytes: atCap,
    });
    expect(result).toEqual({ ok: true });
  });
});
