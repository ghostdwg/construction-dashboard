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

    await expect(checkFileAvailability(key)).resolves.toBe("durable-present");
  });

  test("legacy-present: a recognized legacy absolute path that exists on disk", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "9", "original.pdf");

    fsAccessMock.mockImplementation(async () => undefined); // simulates the file existing

    await expect(checkFileAvailability(legacyPath)).resolves.toBe("legacy-present");
    expect(fsAccessMock).toHaveBeenCalledWith(legacyPath);
  });

  test("missing: a well-formed BlobStore key that has no blob behind it", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(
      checkFileAvailability("plan-room/jobs/9/spec/sections/never_uploaded.pdf")
    ).resolves.toBe("missing");
  });

  test("missing: a recognized legacy path that no longer resolves on disk", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "9", "gone.pdf");

    fsAccessMock.mockImplementation(async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    await expect(checkFileAvailability(legacyPath)).resolves.toBe("missing");
  });

  test("missing: null/undefined/empty reference (nothing recorded)", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(checkFileAvailability(null)).resolves.toBe("missing");
    await expect(checkFileAvailability(undefined)).resolves.toBe("missing");
    await expect(checkFileAvailability("")).resolves.toBe("missing");
  });

  test("invalid: a path-traversal attempt is never treated as present", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(checkFileAvailability("../../../../etc/passwd")).resolves.toBe("invalid");
    await expect(
      checkFileAvailability("plan-room/jobs/9/../../../etc/passwd")
    ).resolves.toBe("invalid");
    expect(fsAccessMock).not.toHaveBeenCalled();
  });

  test("invalid: an absolute path outside the recognized legacy root", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(checkFileAvailability("/etc/passwd")).resolves.toBe("invalid");
    expect(fsAccessMock).not.toHaveBeenCalled();
  });

  test("invalid: a null byte in the reference", async () => {
    const { checkFileAvailability } = await import("../fileAvailability");
    await expect(checkFileAvailability("plan-room/jobs/9/spec/original.pdf\0.png")).resolves.toBe(
      "invalid"
    );
  });
});
