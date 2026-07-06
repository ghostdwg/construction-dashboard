// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/specbook/__tests__/fileAvailability.test.ts
//
//  Exercises checkFileAvailability() against a REAL LocalBlobStore backed by a
//  temp directory (not a mock) so the "durable-present"/"missing" resolution
//  actually proves a file is/isn't on disk under that store, not just that
//  .exists() was called. Only the legacy-path fs.access call is mocked — a
//  different module specifier ("fs/promises") than BlobStore's own "node:fs"
//  import, so mocking it here never touches BlobStore's real file I/O. No
//  real DB and no real (non-temp) storage is touched anywhere in this file.
//
//  checkFileAvailability() now takes a required bidId (the bid the caller
//  already scoped the owning SpecBook/SpecSection record to) — a fixed
//  synthetic bid id of 9 is used for every existing case below (matching the
//  bid id already embedded in these fixtures' paths), plus one new case
//  proving a mismatched bidId is "invalid" even for an otherwise well-formed
//  production-shaped path.
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "specbook-availability-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

const fsAccessMock = vi.fn(async () => undefined);
vi.mock("fs/promises", () => ({
  default: { access: fsAccessMock },
  access: fsAccessMock,
}));

const LEGACY_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "specbooks");
const BID = 9;

describe("checkFileAvailability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsAccessMock.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("durable-present: a BlobStore key that resolves to an existing blob", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    const { getBlobStore } = await import("@/lib/storage/blobStore");

    const key = "plan-room/jobs/9/spec/original.pdf";
    await getBlobStore().put(key, Buffer.from("real spec book bytes"));

    await expect(checkFileAvailability(key, BID)).resolves.toBe("durable-present");
  });

  test("durable-present: a production-shaped legacy-storage-root absolute path for the matching bid", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    const { getBlobStore } = await import("@/lib/storage/blobStore");

    const canonicalKey = "uploads/specbooks/9/book.pdf";
    await getBlobStore().put(canonicalKey, Buffer.from("real spec book bytes"));

    const productionPath = path.join(storageRoot, canonicalKey);
    await expect(checkFileAvailability(productionPath, BID)).resolves.toBe("durable-present");
  });

  test("legacy-present: a recognized legacy absolute path that exists on disk", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "9", "original.pdf");

    fsAccessMock.mockImplementation(async () => undefined); // simulates the file existing

    await expect(checkFileAvailability(legacyPath, BID)).resolves.toBe("legacy-present");
    expect(fsAccessMock).toHaveBeenCalledWith(legacyPath);
  });

  test("missing: a well-formed BlobStore key that has no blob behind it", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(
      checkFileAvailability("plan-room/jobs/9/spec/sections/never_uploaded.pdf", BID)
    ).resolves.toBe("missing");
  });

  test("missing: a recognized legacy path that no longer resolves on disk", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "9", "gone.pdf");

    fsAccessMock.mockImplementation(async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    await expect(checkFileAvailability(legacyPath, BID)).resolves.toBe("missing");
  });

  test("missing: null/undefined/empty reference (nothing recorded)", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(checkFileAvailability(null, BID)).resolves.toBe("missing");
    await expect(checkFileAvailability(undefined, BID)).resolves.toBe("missing");
    await expect(checkFileAvailability("", BID)).resolves.toBe("missing");
  });

  test("invalid: a path-traversal attempt is never treated as present", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(checkFileAvailability("../../../../etc/passwd", BID)).resolves.toBe("invalid");
    await expect(
      checkFileAvailability("plan-room/jobs/9/../../../etc/passwd", BID)
    ).resolves.toBe("invalid");
    expect(fsAccessMock).not.toHaveBeenCalled();
  });

  test("invalid: an absolute path outside the recognized legacy root", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(checkFileAvailability("/etc/passwd", BID)).resolves.toBe("invalid");
    expect(fsAccessMock).not.toHaveBeenCalled();
  });

  test("invalid: a null byte in the reference", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(checkFileAvailability("plan-room/jobs/9/spec/original.pdf\0.png", BID)).resolves.toBe(
      "invalid"
    );
  });

  test("invalid: a production-shaped path whose bid segment does not match the caller-supplied bidId", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    const { getBlobStore } = await import("@/lib/storage/blobStore");

    const canonicalKey = "uploads/specbooks/9/book.pdf";
    await getBlobStore().put(canonicalKey, Buffer.from("real spec book bytes"));

    const productionPath = path.join(storageRoot, canonicalKey);
    // Same physical file as the "durable-present" case above, but this
    // caller expects a different bid — must not be reported as present.
    await expect(checkFileAvailability(productionPath, 999)).resolves.toBe("invalid");
  });
});
