// Module OPS1 (Slice 1) — attachment key shape + upload validation.
import { describe, expect, test } from "vitest";
import {
  TRACKED_ITEM_MAX_UPLOAD_BYTES,
  trackedItemStorageKey,
  validateTrackedItemUpload,
} from "../storagePath";

describe("trackedItems storagePath", () => {
  test("canonical key shape: plan-room/jobs/{bidId}/tracked-items/{itemId}/{safeFileName}", () => {
    expect(trackedItemStorageKey(7, 42, "site photo #3.jpg")).toBe(
      "plan-room/jobs/7/tracked-items/42/site photo _3.jpg"
    );
  });

  test("hostile filenames are sanitized through the shared helper (no traversal, no separators)", () => {
    const key = trackedItemStorageKey(7, 42, "../../.env.staging");
    expect(key.startsWith("plan-room/jobs/7/tracked-items/42/")).toBe(true);
    const fileSegment = key.split("/").pop()!;
    expect(fileSegment).not.toContain("..");
    expect(key).not.toContain("//");
  });

  test("MIME allowlist: jpeg/png/webp/pdf only", () => {
    expect(
      validateTrackedItemUpload({ fileName: "a.jpg", mimeType: "image/jpeg", byteSize: 10 })
    ).toMatchObject({ ok: true, kind: "photo" });
    expect(
      validateTrackedItemUpload({ fileName: "a.png", mimeType: "image/png", byteSize: 10 })
    ).toMatchObject({ ok: true, kind: "photo" });
    expect(
      validateTrackedItemUpload({ fileName: "a.webp", mimeType: "image/webp", byteSize: 10 })
    ).toMatchObject({ ok: true, kind: "photo" });
    expect(
      validateTrackedItemUpload({ fileName: "a.pdf", mimeType: "application/pdf", byteSize: 10 })
    ).toMatchObject({ ok: true, kind: "document" });

    for (const bad of ["image/gif", "text/html", "application/zip", "video/mp4"]) {
      const r = validateTrackedItemUpload({ fileName: "x", mimeType: bad, byteSize: 10 });
      expect(r.ok).toBe(false);
    }
  });

  test("size cap and empty uploads are rejected", () => {
    expect(
      validateTrackedItemUpload({
        fileName: "big.pdf",
        mimeType: "application/pdf",
        byteSize: TRACKED_ITEM_MAX_UPLOAD_BYTES + 1,
      }).ok
    ).toBe(false);
    expect(
      validateTrackedItemUpload({ fileName: "e.pdf", mimeType: "application/pdf", byteSize: 0 })
        .ok
    ).toBe(false);
    expect(
      validateTrackedItemUpload({
        fileName: "ok.pdf",
        mimeType: "application/pdf",
        byteSize: TRACKED_ITEM_MAX_UPLOAD_BYTES,
      }).ok
    ).toBe(true);
  });
});
