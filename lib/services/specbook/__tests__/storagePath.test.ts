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

  test("canonical: a relative BlobStore key", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    expect(classifyStoragePath("plan-room/jobs/9/spec/original.pdf")).toEqual({
      kind: "canonical",
      canonicalKey: "plan-room/jobs/9/spec/original.pdf",
    });
  });

  test("legacy-cwd: the historic process.cwd()-rooted upload path", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(LEGACY_UPLOAD_ROOT, "9", "original.pdf");
    expect(classifyStoragePath(p)).toEqual({ kind: "legacy-cwd" });
  });

  test("legacy-storage-root: the production absolute path rooted at STORAGE_LOCAL_PATH", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = path.join(storageRoot, "uploads", "specbooks", "42", "book.pdf");
    expect(classifyStoragePath(p)).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/specbooks/42/book.pdf",
    });
  });

  test("invalid: an unrecognized absolute path outside both recognized roots", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    expect(classifyStoragePath("/etc/passwd").kind).toBe("invalid");
    expect(classifyStoragePath("/var/other-app/file.pdf").kind).toBe("invalid");
  });

  test("invalid: a bare path-traversal attempt", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    expect(classifyStoragePath("../../../../etc/passwd").kind).toBe("invalid");
    expect(classifyStoragePath("plan-room/jobs/9/../../../etc/passwd").kind).toBe("invalid");
  });

  test("invalid: a traversal attempt embedded inside what otherwise looks like a legacy-storage-root path", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = `${path.join(storageRoot, "uploads", "specbooks", "42")}/../../../etc/passwd`;
    expect(classifyStoragePath(p).kind).toBe("invalid");
  });

  test("invalid: a traversal attempt embedded inside what otherwise looks like a legacy-cwd path", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    const p = `${path.join(LEGACY_UPLOAD_ROOT, "9")}/../../../../etc/passwd`;
    expect(classifyStoragePath(p).kind).toBe("invalid");
  });

  test("invalid: malformed values — empty string, null byte, backslash-leading", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    expect(classifyStoragePath("").kind).toBe("invalid");
    expect(classifyStoragePath("plan-room/jobs/9/spec/original.pdf\0.png").kind).toBe("invalid");
    expect(classifyStoragePath("\\\\some\\legacy\\path").kind).toBe("invalid");
  });
});

describe("legacy-storage-root prefix stripping is controlled, not a substring match", () => {
  afterEach(() => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
  });

  test("varies STORAGE_LOCAL_PATH between cases to prove the prefix isn't hardcoded to /storage", async () => {
    const { classifyStoragePath } = await import("../storagePath");

    process.env.STORAGE_LOCAL_PATH = "/data/blobs";
    expect(classifyStoragePath("/data/blobs/uploads/specbooks/1/book.pdf")).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/specbooks/1/book.pdf",
    });

    process.env.STORAGE_LOCAL_PATH = "/mnt/durable-store";
    expect(classifyStoragePath("/mnt/durable-store/uploads/specbooks/2/book.pdf")).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/specbooks/2/book.pdf",
    });
  });

  test("a path that merely shares a string prefix with the root, without a real path-separator boundary, is not matched", async () => {
    const { classifyStoragePath } = await import("../storagePath");
    process.env.STORAGE_LOCAL_PATH = "/data/blobs";
    // "/data/blobs-decoy/..." starts with the same characters as "/data/blobs"
    // but is not actually rooted there — must be rejected, not stripped.
    expect(classifyStoragePath("/data/blobs-decoy/uploads/specbooks/1/book.pdf").kind).toBe("invalid");
  });
});

describe("classifyStoragePath performs no I/O", () => {
  test("callable with zero fs/BlobStore mocks configured to allow writes — nothing is written/moved/deleted", async () => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
    const { classifyStoragePath } = await import("../storagePath");

    const before = fsSync.readdirSync(storageRoot);
    classifyStoragePath("plan-room/jobs/1/spec/original.pdf");
    classifyStoragePath(path.join(storageRoot, "uploads", "specbooks", "1", "book.pdf"));
    classifyStoragePath(path.join(LEGACY_UPLOAD_ROOT, "1", "book.pdf"));
    classifyStoragePath("../../../etc/passwd");
    classifyStoragePath("/etc/passwd");
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

    const resolved = await resolveLocalPath(key);
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
    const resolved = await resolveLocalPath(productionAbsolutePath);
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

    const resolved = await resolveLocalPath(legacyPath);
    expect(fsAccessMock).toHaveBeenCalledWith(legacyPath);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.kind).toBe("legacy-cwd");
      expect(resolved.localPath).toBe(legacyPath);
    }
  });

  test("missing: a well-formed canonical key with no blob behind it", async () => {
    const { resolveLocalPath } = await import("../storagePath");
    const resolved = await resolveLocalPath("plan-room/jobs/53/spec/never_uploaded.pdf");
    expect(resolved).toEqual({ ok: false, reason: "missing" });
  });

  test("invalid: never touches fs or BlobStore", async () => {
    const { resolveLocalPath } = await import("../storagePath");
    const resolved = await resolveLocalPath("/etc/passwd");
    expect(resolved).toEqual({ ok: false, reason: "invalid" });
    expect(fsAccessMock).not.toHaveBeenCalled();
    expect(fsReadFileMock).not.toHaveBeenCalled();
  });

  test("storagePathExists: boolean convenience wrapper", async () => {
    const { storagePathExists } = await import("../storagePath");
    await expect(storagePathExists("/etc/passwd")).resolves.toBe(false);
    await expect(storagePathExists("plan-room/jobs/54/spec/never_uploaded.pdf")).resolves.toBe(false);
  });

  test("readStoragePathBuffer: reads through BlobStore for canonical, fs.readFile for legacy-cwd, throws for invalid without touching either", async () => {
    const { readStoragePathBuffer } = await import("../storagePath");
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "plan-room/jobs/55/spec/sections/03.pdf";
    await getBlobStore().put(key, Buffer.from("real section bytes"));

    await expect(readStoragePathBuffer(key)).resolves.toEqual(Buffer.from("real section bytes"));

    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "55", "sections", "03.pdf");
    await expect(readStoragePathBuffer(legacyPath)).resolves.toEqual(Buffer.from("legacy pdf bytes"));
    expect(fsReadFileMock).toHaveBeenCalledWith(legacyPath);

    await expect(readStoragePathBuffer("/etc/passwd")).rejects.toThrow();
    expect(fsReadFileMock).toHaveBeenCalledTimes(1); // not called again for the invalid case
  });

  test("deleteStoragePath: deletes through BlobStore for canonical/legacy-storage-root, fs.unlink for legacy-cwd, no-ops for invalid", async () => {
    const { deleteStoragePath } = await import("../storagePath");
    const { getBlobStore } = await import("@/lib/storage/blobStore");

    const key = "plan-room/jobs/56/spec/original.pdf";
    await getBlobStore().put(key, Buffer.from("bytes"));
    await deleteStoragePath(key);
    expect(await getBlobStore().exists(key)).toBe(false);

    const canonicalKey = "uploads/specbooks/56/book.pdf";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));
    await deleteStoragePath(path.join(storageRoot, canonicalKey));
    expect(await getBlobStore().exists(canonicalKey)).toBe(false);

    const legacyPath = path.join(LEGACY_UPLOAD_ROOT, "56", "book.pdf");
    await deleteStoragePath(legacyPath);
    expect(fsUnlinkMock).toHaveBeenCalledWith(legacyPath);

    await deleteStoragePath("../../../etc/passwd");
    expect(fsUnlinkMock).toHaveBeenCalledTimes(1); // still just the one legacy call above
  });
});
