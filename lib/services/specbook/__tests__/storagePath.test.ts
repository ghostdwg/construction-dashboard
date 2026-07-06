// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/specbook/__tests__/storagePath.test.ts
//
//  Full classifier matrix + resolver coverage for the shared storage-path
//  compatibility module that replaced the isLegacyUploadPath()/
//  LEGACY_UPLOAD_ROOT logic formerly duplicated across fileAvailability.ts
//  and three Spec Book routes. Uses a REAL LocalBlobStore backed by a temp
//  directory (not a mock) for the canonical/legacy-storage-root resolver
//  cases, so "present"/"missing" resolution actually proves a file is/isn't
//  on disk under that store. Only the legacy-cwd fs calls are mocked — a
//  different module specifier ("fs/promises") than BlobStore's own
//  "node:fs" import, so mocking it here never touches BlobStore's real I/O.
//  No real DB and no real (non-temp) storage is touched anywhere in this file.
//
//  Every classifyStoragePath()/resolver call below now takes a required
//  bidId (a fixed synthetic bid id of 42 for cases that don't specifically
//  test bid-scoping) — proving bid-scoping is structurally mandatory, and
//  that it does not change canonical/legacy-cwd outcomes at all.
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "storagepath-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

const LEGACY_UPLOAD_ROOT = path.join(process.cwd(), "uploads", "specbooks");
const BID = 42;

const fsAccessMock = vi.fn(async () => undefined);
const fsReadFileMock = vi.fn(async () => Buffer.from("legacy pdf bytes"));
const fsUnlinkMock = vi.fn(async () => undefined);
vi.mock("fs/promises", () => ({
  default: { access: fsAccessMock, readFile: fsReadFileMock, unlink: fsUnlinkMock },
  access: fsAccessMock,
  readFile: fsReadFileMock,
  unlink: fsUnlinkMock,
}));

describe("classifyStoragePath — pure classification matrix", () => {
  beforeEach(() => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
  });

  test("canonical: a relative BlobStore key (bid-scoping is a no-op for this shape)", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    expect(classifyStoragePath("plan-room/jobs/9/spec/original.pdf", BID)).toEqual({
      kind: "canonical",
      canonicalKey: "plan-room/jobs/9/spec/original.pdf",
    });
    // A completely different bidId does not change the outcome.
    expect(classifyStoragePath("plan-room/jobs/9/spec/original.pdf", 999)).toEqual({
      kind: "canonical",
      canonicalKey: "plan-room/jobs/9/spec/original.pdf",
    });
  });

  test("legacy-cwd: the historic process.cwd()-rooted upload path (bid-scoping is a no-op for this shape)", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(LEGACY_UPLOAD_ROOT, "9", "original.pdf");
    expect(classifyStoragePath(p, BID)).toEqual({ kind: "legacy-cwd" });
    // A completely different bidId does not change the outcome.
    expect(classifyStoragePath(p, 999)).toEqual({ kind: "legacy-cwd" });
  });

  test("legacy-storage-root: the production absolute path rooted at STORAGE_LOCAL_PATH, matching bidId", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(storageRoot, "uploads", "specbooks", "42", "book.pdf");
    expect(classifyStoragePath(p, 42)).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/specbooks/42/book.pdf",
    });
  });

  test("legacy-storage-root: a section path (extra nested segment) also matches, for the matching bidId", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(storageRoot, "uploads", "specbooks", "42", "sections", "03_30_00_concrete.pdf");
    expect(classifyStoragePath(p, 42)).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/specbooks/42/sections/03_30_00_concrete.pdf",
    });
  });

  test("invalid: the exact production-shaped path but called with a DIFFERENT expected bidId is rejected, not accepted", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(storageRoot, "uploads", "specbooks", "42", "book.pdf");
    // Same physical path as the accept case above — only the expected bidId differs.
    expect(classifyStoragePath(p, 99).kind).toBe("invalid");
  });

  test("invalid: a bare file directly under the storage root", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(storageRoot, ".env");
    expect(classifyStoragePath(p, BID).kind).toBe("invalid");
  });

  test("invalid: a different top-level namespace under the storage root (not uploads/specbooks)", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(storageRoot, "plan-room", "unrelated.pdf");
    expect(classifyStoragePath(p, BID).kind).toBe("invalid");
  });

  test("invalid: right uploads/ prefix, wrong second segment (not specbooks)", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(storageRoot, "uploads", "unrelated", "file.pdf");
    expect(classifyStoragePath(p, BID).kind).toBe("invalid");
  });

  test("invalid: an unrecognized absolute path outside both recognized roots", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    expect(classifyStoragePath("/etc/passwd", BID).kind).toBe("invalid");
    expect(classifyStoragePath("/var/other-app/file.pdf", BID).kind).toBe("invalid");
  });

  test("invalid: a bare path-traversal attempt", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    expect(classifyStoragePath("../../../../etc/passwd", BID).kind).toBe("invalid");
    expect(classifyStoragePath("plan-room/jobs/9/../../../etc/passwd", BID).kind).toBe("invalid");
  });

  test("invalid: a traversal attempt embedded inside what otherwise looks like a legacy-storage-root path", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = `${path.join(storageRoot, "uploads", "specbooks", "42")}/../../../etc/passwd`;
    expect(classifyStoragePath(p, BID).kind).toBe("invalid");
  });

  test("invalid: a traversal attempt embedded inside what otherwise looks like a legacy-cwd path", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = `${path.join(LEGACY_UPLOAD_ROOT, "9")}/../../../../etc/passwd`;
    expect(classifyStoragePath(p, BID).kind).toBe("invalid");
  });

  test("invalid: malformed values — empty string, null byte, backslash-leading", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    expect(classifyStoragePath("", BID).kind).toBe("invalid");
    expect(classifyStoragePath("plan-room/jobs/9/spec/original.pdf\0.png", BID).kind).toBe("invalid");
    expect(classifyStoragePath("\\\\some\\legacy\\path", BID).kind).toBe("invalid");
  });
});

describe("legacy-storage-root prefix stripping is controlled, not a substring match", () => {
  afterEach(() => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
  });

  test("varies STORAGE_LOCAL_PATH between cases to prove the prefix isn't hardcoded to /storage", async () => {
    const { classifyStoragePath } = await import("../storagePath");

    process.env.STORAGE_LOCAL_PATH = "/data/blobs";
    expect(classifyStoragePath("/data/blobs/uploads/specbooks/1/book.pdf", 1)).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/specbooks/1/book.pdf",
    });

    process.env.STORAGE_LOCAL_PATH = "/mnt/durable-store";
    expect(classifyStoragePath("/mnt/durable-store/uploads/specbooks/2/book.pdf", 2)).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/specbooks/2/book.pdf",
    });
  });

  test("a path that merely shares a string prefix with the root, without a real path-separator boundary, is not matched", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    process.env.STORAGE_LOCAL_PATH = "/data/blobs";
    // "/data/blobs-decoy/..." starts with the same characters as "/data/blobs"
    // but is not actually rooted there — must be rejected, not stripped.
    expect(classifyStoragePath("/data/blobs-decoy/uploads/specbooks/1/book.pdf", 1).kind).toBe("invalid");
  });
});

describe("classifyStoragePath performs no I/O", () => {
  test("callable with zero fs/BlobStore mocks configured to allow writes — nothing is written/moved/deleted", async () => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
    const { classifyStoragePath } = await import("../storagePath");

    const before = fsSync.readdirSync(storageRoot);
    classifyStoragePath("plan-room/jobs/1/spec/original.pdf", BID);
    classifyStoragePath(path.join(storageRoot, "uploads", "specbooks", "1", "book.pdf"), 1);
    classifyStoragePath(path.join(LEGACY_UPLOAD_ROOT, "1", "book.pdf"), BID);
    classifyStoragePath("../../../etc/passwd", BID);
    classifyStoragePath("/etc/passwd", BID);
    const after = fsSync.readdirSync(storageRoot);

    expect(after).toEqual(before);
    expect(fsAccessMock).not.toHaveBeenCalled();
    expect(fsReadFileMock).not.toHaveBeenCalled();
    expect(fsUnlinkMock).not.toHaveBeenCalled();
  });
});

describe("resolveLocalPath / storagePathExists / readStoragePathBuffer / deleteStoragePath — resolver dispatch", () => {
  beforeEach(() => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
    vi.clearAllMocks();
    fsAccessMock.mockImplementation(async () => undefined);
    fsReadFileMock.mockImplementation(async () => Buffer.from("legacy pdf bytes"));
    fsUnlinkMock.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("canonical: resolves to a real local path once the blob exists", async () => {
    const { resolveLocalPath } = await import("../storagePath");
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "plan-room/jobs/50/spec/original.pdf";
    await getBlobStore().put(key, Buffer.from("bytes"));

    const resolved = await resolveLocalPath(key, BID);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.kind).toBe("canonical");
      expect(resolved.localPath).toBe(path.join(storageRoot, key));
    }
  });

  test("legacy-storage-root: derives the canonical key and resolves via BlobStore against the same physical file", async () => {
    const { resolveLocalPath } = await import("../storagePath");
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const canonicalKey = "uploads/specbooks/51/book.pdf";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));

    const productionAbsolutePath = path.join(storageRoot, canonicalKey);
    const resolved = await resolveLocalPath(productionAbsolutePath, 51);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.kind).toBe("legacy-storage-root");
      expect(resolved.canonicalKey).toBe(canonicalKey);
      expect(resolved.localPath).toBe(path.join(storageRoot, canonicalKey));
    }
  });

  test("legacy-cwd: uses fs.access directly against the raw absolute path", async () => {
    const { resolveLocalPath } = await import("../storagePath");
    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "52", "book.pdf");

    const resolved = await resolveLocalPath(legacyPath, BID);
    expect(fsAccessMock).toHaveBeenCalledWith(legacyPath);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.kind).toBe("legacy-cwd");
      expect(resolved.localPath).toBe(legacyPath);
    }
  });

  test("missing: a well-formed canonical key with no blob behind it", async () => {
    const { resolveLocalPath } = await import("../storagePath");
    const resolved = await resolveLocalPath("plan-room/jobs/53/spec/never_uploaded.pdf", BID);
    expect(resolved).toEqual({ ok: false, reason: "missing" });
  });

  test("invalid: never touches fs or BlobStore", async () => {
    const { resolveLocalPath } = await import("../storagePath");
    const resolved = await resolveLocalPath("/etc/passwd", BID);
    expect(resolved).toEqual({ ok: false, reason: "invalid" });
    expect(fsAccessMock).not.toHaveBeenCalled();
    expect(fsReadFileMock).not.toHaveBeenCalled();
  });

  test("storagePathExists: boolean convenience wrapper", async () => {
    const { storagePathExists } = await import("../storagePath");
    await expect(storagePathExists("/etc/passwd", BID)).resolves.toBe(false);
    await expect(storagePathExists("plan-room/jobs/54/spec/never_uploaded.pdf", BID)).resolves.toBe(false);
  });

  test("readStoragePathBuffer: reads through BlobStore for canonical, fs.readFile for legacy-cwd, throws for invalid without touching either", async () => {
    const { readStoragePathBuffer } = await import("../storagePath");
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "plan-room/jobs/55/spec/sections/03.pdf";
    await getBlobStore().put(key, Buffer.from("real section bytes"));

    await expect(readStoragePathBuffer(key, BID)).resolves.toEqual(Buffer.from("real section bytes"));

    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "55", "sections", "03.pdf");
    await expect(readStoragePathBuffer(legacyPath, BID)).resolves.toEqual(Buffer.from("legacy pdf bytes"));
    expect(fsReadFileMock).toHaveBeenCalledWith(legacyPath);

    await expect(readStoragePathBuffer("/etc/passwd", BID)).rejects.toThrow();
    expect(fsReadFileMock).toHaveBeenCalledTimes(1); // not called again for the invalid case
  });

  test("deleteStoragePath: deletes through BlobStore for canonical/legacy-storage-root, fs.unlink for legacy-cwd, no-ops for invalid", async () => {
    const { deleteStoragePath } = await import("../storagePath");
    const { getBlobStore } = await import("@/lib/storage/blobStore");

    const key = "plan-room/jobs/56/spec/original.pdf";
    await getBlobStore().put(key, Buffer.from("bytes"));
    await deleteStoragePath(key, BID);
    expect(await getBlobStore().exists(key)).toBe(false);

    const canonicalKey = "uploads/specbooks/56/book.pdf";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));
    await deleteStoragePath(path.join(storageRoot, canonicalKey), 56);
    expect(await getBlobStore().exists(canonicalKey)).toBe(false);

    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "56", "book.pdf");
    await deleteStoragePath(legacyPath, BID);
    expect(fsUnlinkMock).toHaveBeenCalledWith(legacyPath);

    await deleteStoragePath("../../../etc/passwd", BID);
    expect(fsUnlinkMock).toHaveBeenCalledTimes(1); // still just the one legacy call above
  });

  test("resolveLocalPath: a wrong-bid production-shaped path is rejected before any BlobStore/localPathForKey call, even if a blob exists at that key", async () => {
    const { resolveLocalPath } = await import("../storagePath");
    const blobStoreModule = await import("@/lib/storage/blobStore");
    const { getBlobStore } = blobStoreModule;
    const localPathForKeySpy = vi.spyOn(blobStoreModule, "localPathForKey");
    const blobStore = getBlobStore();
    const getSpy = vi.spyOn(blobStore, "get");
    const existsSpy = vi.spyOn(blobStore, "exists");
    const deleteSpy = vi.spyOn(blobStore, "delete");

    // A real blob exists at this key — proving rejection isn't just an
    // artifact of "missing", it's a structural refusal to even ask.
    const canonicalKey = "uploads/specbooks/60/book.pdf";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));
    const wrongBidPath = path.join(storageRoot, canonicalKey);

    const resolved = await resolveLocalPath(wrongBidPath, 61); // expects bid 61, path is bid 60's
    expect(resolved).toEqual({ ok: false, reason: "invalid" });
    expect(existsSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(localPathForKeySpy).not.toHaveBeenCalled();

    existsSpy.mockRestore();
    getSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test("readStoragePathBuffer / deleteStoragePath: wrong-bid and wrong-namespace paths never reach getBlobStore().get/.delete", async () => {
    const { readStoragePathBuffer, deleteStoragePath } = await import("../storagePath");
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const blobStore = getBlobStore();
    const getSpy = vi.spyOn(blobStore, "get");
    const deleteSpy = vi.spyOn(blobStore, "delete");

    const canonicalKey = "uploads/specbooks/62/book.pdf";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));
    const wrongBidPath = path.join(storageRoot, canonicalKey);
    const wrongNamespacePath = path.join(storageRoot, "plan-room", "unrelated.pdf");

    await expect(readStoragePathBuffer(wrongBidPath, 63)).rejects.toThrow();
    await expect(readStoragePathBuffer(wrongNamespacePath, 62)).rejects.toThrow();
    expect(getSpy).not.toHaveBeenCalled();

    await deleteStoragePath(wrongBidPath, 63);
    await deleteStoragePath(wrongNamespacePath, 62);
    expect(deleteSpy).not.toHaveBeenCalled();

    // The blob at the real key is untouched by either invalid attempt.
    expect(await getBlobStore().exists(canonicalKey)).toBe(true);

    getSpy.mockRestore();
    deleteSpy.mockRestore();
  });
});
