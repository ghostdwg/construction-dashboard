// Module OPS3 (Phase 1A) — content-addressed storage keys. The key derives
// from bid + sha-256 only: no client-supplied filename can influence it.
import { describe, expect, test } from "vitest";

import { consultantReportStorageKey } from "../storagePath";
import { sha256Hex } from "../index";

describe("consultantReportStorageKey", () => {
  test("is content-addressed under the bid's consultant-reports prefix", () => {
    const checksum = sha256Hex(Buffer.from("%PDF-1.7 test", "ascii"));
    expect(consultantReportStorageKey(42, checksum)).toBe(
      `plan-room/jobs/42/consultant-reports/${checksum}.pdf`
    );
  });

  test("identical bytes yield the identical key (dedupe by construction)", () => {
    const a = sha256Hex(Buffer.from("same bytes"));
    const b = sha256Hex(Buffer.from("same bytes"));
    expect(consultantReportStorageKey(7, a)).toBe(consultantReportStorageKey(7, b));
  });

  test("different bids never collide even for identical bytes", () => {
    const checksum = sha256Hex(Buffer.from("same bytes"));
    expect(consultantReportStorageKey(1, checksum)).not.toBe(
      consultantReportStorageKey(2, checksum)
    );
  });
});
