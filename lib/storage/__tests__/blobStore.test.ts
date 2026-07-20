// ──────────────────────────────────────────────────────────────────────────────
//  lib/storage/__tests__/blobStore.test.ts
//
//  Focused coverage for the new local-path handoff helper added for the Spec
//  Book split route (sidecar needs a real filesystem path). Goes through the
//  same assertSafeKey validation as put/get/delete, so this also locks in
//  that the handoff can never escape the storage root.
// ──────────────────────────────────────────────────────────────────────────────

import fsSync from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  BlobNotFoundError,
  LocalBlobStore,
  getBlobStore,
  localPathForKey,
  resetBlobStoreSingleton,
  safeBlobFileName,
} from "../blobStore";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fsSync.mkdtempSync(path.join(os.tmpdir(), "blobstore-localpath-test-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
});

afterAll(() => {
  fsSync.rmSync(storageRoot, { recursive: true, force: true });
});

describe("LocalBlobStore.localPath", () => {
  test("resolves a key to an absolute path under root", () => {
    const store = new LocalBlobStore(storageRoot);
    const full = store.localPath("plan-room/jobs/1/spec/original.pdf");
    expect(full).toBe(path.join(storageRoot, "plan-room/jobs/1/spec/original.pdf"));
  });

  test("rejects traversal", () => {
    const store = new LocalBlobStore(storageRoot);
    expect(() => store.localPath("../../etc/passwd")).toThrow(/traversal/i);
  });

  test("rejects a leading-slash key (absolute-looking key is not a valid key)", () => {
    const store = new LocalBlobStore(storageRoot);
    expect(() => store.localPath("/etc/passwd")).toThrow(/absolute path not allowed/i);
  });
});

describe("LocalBlobStore durable metadata and recreation", () => {
  test("preserves content type and size across store instances", async () => {
    const key = "plan-room/jobs/8/drawings/immutable/plan.pdf";
    const first = new LocalBlobStore(storageRoot);
    await first.put(key, Buffer.from("durable bytes"), { contentType: "application/pdf" });

    const recreated = new LocalBlobStore(storageRoot);
    await expect(recreated.get(key)).resolves.toEqual(Buffer.from("durable bytes"));
    await expect(recreated.stat(key)).resolves.toMatchObject({
      size: 13,
      contentType: "application/pdf",
    });
  });

  test("survives singleton reset simulating application-container recreation", async () => {
    const key = "plan-room/jobs/8/addenda/immutable/addendum.pdf";
    await getBlobStore().put(key, Buffer.from("after restart"), {
      contentType: "application/pdf",
    });
    resetBlobStoreSingleton();
    await expect(getBlobStore().get(key)).resolves.toEqual(Buffer.from("after restart"));
  });

  test("missing get has a stable not-found error type", async () => {
    await expect(
      new LocalBlobStore(storageRoot).get("plan-room/jobs/8/drawings/missing/file.pdf"),
    ).rejects.toBeInstanceOf(BlobNotFoundError);
  });

  test("rejects non-normalized and backslash-separated keys", () => {
    const store = new LocalBlobStore(storageRoot);
    expect(() => store.localPath("plan-room//jobs/8/file.pdf")).toThrow(/normalized/i);
    expect(() => store.localPath("plan-room\\jobs\\8\\file.pdf")).toThrow(/backslash/i);
  });
});

describe("localPathForKey (module-level helper, uses the configured singleton store)", () => {
  test("derives the same absolute path as the singleton's root", () => {
    const full = localPathForKey("plan-room/jobs/2/spec/sections/03_30_00.pdf");
    expect(full).toBe(path.join(storageRoot, "plan-room/jobs/2/spec/sections/03_30_00.pdf"));
  });

  test("rejects traversal the same way put/get/delete do", () => {
    expect(() => localPathForKey("../outside.pdf")).toThrow(/traversal/i);
  });
});

describe("safeBlobFileName", () => {
  test("normal PDF filename passes through unchanged", () => {
    expect(safeBlobFileName("original.pdf")).toBe("original.pdf");
  });

  test("normal image filename passes through unchanged", () => {
    expect(safeBlobFileName("site-photo (1).jpg")).toBe("site-photo (1).jpg");
  });

  test("bare '.' falls back to upload.bin", () => {
    expect(safeBlobFileName(".")).toBe("upload.bin");
  });

  test("bare '..' falls back to upload.bin", () => {
    expect(safeBlobFileName("..")).toBe("upload.bin");
  });

  test("'./' falls back to upload.bin", () => {
    expect(safeBlobFileName("./")).toBe("upload.bin");
  });

  test("'../' falls back to upload.bin", () => {
    expect(safeBlobFileName("../")).toBe("upload.bin");
  });

  test("traversal attempt reduces to the trailing basename, not a fallback", () => {
    expect(safeBlobFileName("../../etc/passwd")).toBe("passwd");
  });

  test("empty string falls back to upload.bin", () => {
    expect(safeBlobFileName("")).toBe("upload.bin");
  });

  test("whitespace-only name falls back to upload.bin", () => {
    expect(safeBlobFileName("   ")).toBe("upload.bin");
  });
});
