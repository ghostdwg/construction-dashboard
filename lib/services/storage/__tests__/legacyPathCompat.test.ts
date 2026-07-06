// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/storage/__tests__/legacyPathCompat.test.ts
//
//  Full classifier matrix + resolver coverage for the shared, domain-
//  parameterized factory that Drawings/Estimates/Addendums/Meetings each
//  instantiate independently (see lib/services/drawings/storagePath.ts and
//  its three sibling modules). Mirrors
//  lib/services/specbook/__tests__/storagePath.test.ts's conventions
//  exactly — same real-temp-dir LocalBlobStore usage, same mocked
//  "fs/promises" for the legacy-cwd path only, same spy-verified "never
//  reaches BlobStore/localPathForKey for an invalid classification"
//  assertions.
//
//  This file exercises createLegacyPathCompat() generically with a
//  SINGLE-segment scope (mirroring Drawings/Addendums/Meetings) AND proves
//  the MULTI-segment scope generalization (mirroring Estimates'
//  {bidId}/{subcontractorId}) works, plus that two independently-created
//  instances never recognize each other's shapes — the structural
//  cross-domain isolation the whole design is built around.
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "legacypathcompat-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

const LEGACY_DRAWINGS_ROOT = path.join(process.cwd(), "uploads", "drawings");

const fsAccessMock = vi.fn(async () => undefined);
const fsReadFileMock = vi.fn(async () => Buffer.from("legacy audio/pdf bytes"));
const fsUnlinkMock = vi.fn(async () => undefined);
vi.mock("fs/promises", () => ({
  default: { access: fsAccessMock, readFile: fsReadFileMock, unlink: fsUnlinkMock },
  access: fsAccessMock,
  readFile: fsReadFileMock,
  unlink: fsUnlinkMock,
}));

describe("createLegacyPathCompat — single-segment scope (Drawings/Addendums/Meetings shape)", () => {
  beforeEach(() => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
  });

  test("canonical: a relative BlobStore key (scope is a no-op for this shape)", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    expect(compat.classify("uploads/drawings/9/plan.pdf", [42])).toEqual({
      kind: "canonical",
      canonicalKey: "uploads/drawings/9/plan.pdf",
    });
    expect(compat.classify("uploads/drawings/9/plan.pdf", [999])).toEqual({
      kind: "canonical",
      canonicalKey: "uploads/drawings/9/plan.pdf",
    });
  });

  test("legacy-cwd: process.cwd()-rooted upload path (scope is a no-op for this shape)", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    const p = path.join(LEGACY_DRAWINGS_ROOT, "9", "plan.pdf");
    expect(compat.classify(p, [42])).toEqual({ kind: "legacy-cwd" });
    expect(compat.classify(p, [999])).toEqual({ kind: "legacy-cwd" });
  });

  test("legacy-storage-root: the production absolute path rooted at STORAGE_LOCAL_PATH, matching scope", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    const p = path.join(storageRoot, "uploads", "drawings", "42", "plan.pdf");
    expect(compat.classify(p, [42])).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/drawings/42/plan.pdf",
    });
  });

  test("invalid: the exact production-shaped path but a DIFFERENT expected scope is rejected", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    const p = path.join(storageRoot, "uploads", "drawings", "42", "plan.pdf");
    expect(compat.classify(p, [99]).kind).toBe("invalid");
  });

  test("invalid: a bare file directly under the storage root, or no segment beyond scope", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    expect(compat.classify(path.join(storageRoot, ".env"), [42]).kind).toBe("invalid");
    expect(compat.classify(path.join(storageRoot, "uploads", "drawings", "42"), [42]).kind).toBe("invalid");
  });

  test("invalid: a bare path-traversal attempt, null byte, or backslash-leading value", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    expect(compat.classify("../../../../etc/passwd", [42]).kind).toBe("invalid");
    expect(compat.classify("uploads/drawings/9/plan.pdf\0.png", [42]).kind).toBe("invalid");
    expect(compat.classify("\\\\some\\legacy\\path", [42]).kind).toBe("invalid");
    expect(compat.classify("", [42]).kind).toBe("invalid");
  });

  test("classify performs no I/O", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    const before = fsSync.readdirSync(storageRoot);
    compat.classify("uploads/drawings/1/plan.pdf", [1]);
    compat.classify(path.join(storageRoot, "uploads", "drawings", "1", "plan.pdf"), [1]);
    compat.classify(path.join(LEGACY_DRAWINGS_ROOT, "1", "plan.pdf"), [1]);
    compat.classify("../../../etc/passwd", [1]);
    const after = fsSync.readdirSync(storageRoot);
    expect(after).toEqual(before);
    expect(fsAccessMock).not.toHaveBeenCalled();
    expect(fsReadFileMock).not.toHaveBeenCalled();
    expect(fsUnlinkMock).not.toHaveBeenCalled();
  });
});

describe("createLegacyPathCompat — multi-segment scope (Estimates' {bidId}/{subcontractorId} shape)", () => {
  beforeEach(() => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
  });

  test("legacy-storage-root: requires BOTH scope segments to match, in order", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "estimates"],
      legacyStorageRootSegments: ["uploads", "estimates"],
    });
    const p = path.join(storageRoot, "uploads", "estimates", "5", "17", "bid.pdf");
    expect(compat.classify(p, [5, 17])).toEqual({
      kind: "legacy-storage-root",
      canonicalKey: "uploads/estimates/5/17/bid.pdf",
    });
    // Wrong subcontractorId — rejected even though bidId matches.
    expect(compat.classify(p, [5, 99]).kind).toBe("invalid");
    // Wrong bidId — rejected even though subcontractorId matches.
    expect(compat.classify(p, [99, 17]).kind).toBe("invalid");
    // Segments reversed — rejected (order matters).
    expect(compat.classify(p, [17, 5]).kind).toBe("invalid");
  });

  test("invalid: only one scope segment worth of path beyond the root (no filename segment left)", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const compat = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "estimates"],
      legacyStorageRootSegments: ["uploads", "estimates"],
    });
    const p = path.join(storageRoot, "uploads", "estimates", "5", "17");
    expect(compat.classify(p, [5, 17]).kind).toBe("invalid");
  });
});

describe("createLegacyPathCompat — independent instances never recognize each other's shapes", () => {
  beforeEach(() => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
  });

  test("a Drawings-shaped legacy-cwd path is NOT recognized by an Estimates instance, and vice versa", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const drawings = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    const estimates = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "estimates"],
      legacyStorageRootSegments: ["uploads", "estimates"],
    });

    const drawingsLegacyPath = path.join(process.cwd(), "uploads", "drawings", "1", "plan.pdf");
    expect(drawings.classify(drawingsLegacyPath, [1]).kind).toBe("legacy-cwd");
    expect(estimates.classify(drawingsLegacyPath, [1, 2]).kind).toBe("invalid");

    const estimatesLegacyPath = path.join(process.cwd(), "uploads", "estimates", "1", "2", "bid.pdf");
    expect(estimates.classify(estimatesLegacyPath, [1, 2]).kind).toBe("legacy-cwd");
    expect(drawings.classify(estimatesLegacyPath, [1]).kind).toBe("invalid");
  });

  test("a Drawings-shaped legacy-storage-root path is NOT recognized by an Addendums instance", async () => {
    const { createLegacyPathCompat } = await import("../legacyPathCompat");
    const drawings = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "drawings"],
      legacyStorageRootSegments: ["uploads", "drawings"],
    });
    const addendums = createLegacyPathCompat({
      legacyCwdSegments: ["uploads", "addendums"],
      legacyStorageRootSegments: ["uploads", "addendums"],
    });

    const p = path.join(storageRoot, "uploads", "drawings", "1", "plan.pdf");
    expect(drawings.classify(p, [1]).kind).toBe("legacy-storage-root");
    expect(addendums.classify(p, [1]).kind).toBe("invalid");
  });
});

describe("resolveLocalPath / storagePathExists / readBuffer / deletePath — resolver dispatch", () => {
  beforeEach(() => {
    process.env.STORAGE_LOCAL_PATH = storageRoot;
    vi.clearAllMocks();
    fsAccessMock.mockImplementation(async () => undefined);
    fsReadFileMock.mockImplementation(async () => Buffer.from("legacy audio/pdf bytes"));
    fsUnlinkMock.mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeCompat() {
    return async () => {
      const { createLegacyPathCompat } = await import("../legacyPathCompat");
      return createLegacyPathCompat({
        legacyCwdSegments: ["uploads", "meetings"],
        legacyStorageRootSegments: ["uploads", "meetings"],
      });
    };
  }

  test("canonical: resolves to a real local path once the blob exists", async () => {
    const compat = await makeCompat()();
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "uploads/meetings/50/audio.wav";
    await getBlobStore().put(key, Buffer.from("bytes"));

    const resolved = await compat.resolveLocalPath(key, [50]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.kind).toBe("canonical");
      expect(resolved.localPath).toBe(path.join(storageRoot, key));
    }
  });

  test("legacy-storage-root: derives the canonical key and resolves via BlobStore against the same physical file", async () => {
    const compat = await makeCompat()();
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const canonicalKey = "uploads/meetings/51/audio.wav";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));

    const productionAbsolutePath = path.join(storageRoot, canonicalKey);
    const resolved = await compat.resolveLocalPath(productionAbsolutePath, [51]);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.kind).toBe("legacy-storage-root");
      expect(resolved.canonicalKey).toBe(canonicalKey);
    }
  });

  test("legacy-cwd: uses fs.access directly against the raw absolute path", async () => {
    const compat = await makeCompat()();
    const legacyPath = path.join(process.cwd(), "uploads", "meetings", "52", "audio.wav");

    const resolved = await compat.resolveLocalPath(legacyPath, [52]);
    expect(fsAccessMock).toHaveBeenCalledWith(legacyPath);
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.kind).toBe("legacy-cwd");
      expect(resolved.localPath).toBe(legacyPath);
    }
  });

  test("missing: a well-formed canonical key with no blob behind it", async () => {
    const compat = await makeCompat()();
    const resolved = await compat.resolveLocalPath("uploads/meetings/53/never_uploaded.wav", [53]);
    expect(resolved).toEqual({ ok: false, reason: "missing" });
  });

  test("invalid: never touches fs or BlobStore", async () => {
    const compat = await makeCompat()();
    const resolved = await compat.resolveLocalPath("/etc/passwd", [53]);
    expect(resolved).toEqual({ ok: false, reason: "invalid" });
    expect(fsAccessMock).not.toHaveBeenCalled();
    expect(fsReadFileMock).not.toHaveBeenCalled();
  });

  test("storagePathExists: boolean convenience wrapper", async () => {
    const compat = await makeCompat()();
    await expect(compat.storagePathExists("/etc/passwd", [53])).resolves.toBe(false);
    await expect(compat.storagePathExists("uploads/meetings/54/never_uploaded.wav", [54])).resolves.toBe(false);
  });

  test("readBuffer: reads through BlobStore for canonical, fs.readFile for legacy-cwd, throws for invalid without touching either", async () => {
    const compat = await makeCompat()();
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const key = "uploads/meetings/55/audio.wav";
    await getBlobStore().put(key, Buffer.from("real audio bytes"));

    await expect(compat.readBuffer(key, [55])).resolves.toEqual(Buffer.from("real audio bytes"));

    const legacyPath = path.join(process.cwd(), "uploads", "meetings", "55", "audio.wav");
    await expect(compat.readBuffer(legacyPath, [55])).resolves.toEqual(Buffer.from("legacy audio/pdf bytes"));
    expect(fsReadFileMock).toHaveBeenCalledWith(legacyPath);

    await expect(compat.readBuffer("/etc/passwd", [55])).rejects.toThrow();
    expect(fsReadFileMock).toHaveBeenCalledTimes(1); // not called again for the invalid case
  });

  test("deletePath: deletes through BlobStore for canonical/legacy-storage-root, fs.unlink for legacy-cwd, no-ops for invalid", async () => {
    const compat = await makeCompat()();
    const { getBlobStore } = await import("@/lib/storage/blobStore");

    const key = "uploads/meetings/56/audio.wav";
    await getBlobStore().put(key, Buffer.from("bytes"));
    await compat.deletePath(key, [56]);
    expect(await getBlobStore().exists(key)).toBe(false);

    const canonicalKey = "uploads/meetings/57/audio.wav";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));
    await compat.deletePath(path.join(storageRoot, canonicalKey), [57]);
    expect(await getBlobStore().exists(canonicalKey)).toBe(false);

    const legacyPath = path.join(process.cwd(), "uploads", "meetings", "58", "audio.wav");
    await compat.deletePath(legacyPath, [58]);
    expect(fsUnlinkMock).toHaveBeenCalledWith(legacyPath);

    await compat.deletePath("../../../etc/passwd", [58]);
    expect(fsUnlinkMock).toHaveBeenCalledTimes(1); // still just the one legacy call above
  });

  test("resolveLocalPath: a wrong-scope production-shaped path is rejected before any BlobStore/localPathForKey call, even if a blob exists at that key", async () => {
    const compat = await makeCompat()();
    const blobStoreModule = await import("@/lib/storage/blobStore");
    const { getBlobStore } = blobStoreModule;
    const localPathForKeySpy = vi.spyOn(blobStoreModule, "localPathForKey");
    const blobStore = getBlobStore();
    const getSpy = vi.spyOn(blobStore, "get");
    const existsSpy = vi.spyOn(blobStore, "exists");
    const deleteSpy = vi.spyOn(blobStore, "delete");

    const canonicalKey = "uploads/meetings/60/audio.wav";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));
    const wrongScopePath = path.join(storageRoot, canonicalKey);

    const resolved = await compat.resolveLocalPath(wrongScopePath, [61]); // expects meeting 61, path is meeting 60's
    expect(resolved).toEqual({ ok: false, reason: "invalid" });
    expect(existsSpy).not.toHaveBeenCalled();
    expect(getSpy).not.toHaveBeenCalled();
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(localPathForKeySpy).not.toHaveBeenCalled();

    existsSpy.mockRestore();
    getSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test("readBuffer / deletePath: wrong-scope and wrong-namespace paths never reach getBlobStore().get/.delete", async () => {
    const compat = await makeCompat()();
    const { getBlobStore } = await import("@/lib/storage/blobStore");
    const blobStore = getBlobStore();
    const getSpy = vi.spyOn(blobStore, "get");
    const deleteSpy = vi.spyOn(blobStore, "delete");

    const canonicalKey = "uploads/meetings/62/audio.wav";
    await getBlobStore().put(canonicalKey, Buffer.from("bytes"));
    const wrongScopePath = path.join(storageRoot, canonicalKey);
    const wrongNamespacePath = path.join(storageRoot, "plan-room", "unrelated.pdf");

    await expect(compat.readBuffer(wrongScopePath, [63])).rejects.toThrow();
    await expect(compat.readBuffer(wrongNamespacePath, [62])).rejects.toThrow();
    expect(getSpy).not.toHaveBeenCalled();

    await compat.deletePath(wrongScopePath, [63]);
    await compat.deletePath(wrongNamespacePath, [62]);
    expect(deleteSpy).not.toHaveBeenCalled();

    expect(await getBlobStore().exists(canonicalKey)).toBe(true);

    getSpy.mockRestore();
    deleteSpy.mockRestore();
  });
});
