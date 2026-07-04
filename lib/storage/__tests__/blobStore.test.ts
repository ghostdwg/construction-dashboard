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
import { LocalBlobStore, localPathForKey } from "../blobStore";

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

describe("localPathForKey (module-level helper, uses the configured singleton store)", () => {
  test("derives the same absolute path as the singleton's root", () => {
    const full = localPathForKey("plan-room/jobs/2/spec/sections/03_30_00.pdf");
    expect(full).toBe(path.join(storageRoot, "plan-room/jobs/2/spec/sections/03_30_00.pdf"));
  });

  test("rejects traversal the same way put/get/delete do", () => {
    expect(() => localPathForKey("../outside.pdf")).toThrow(/traversal/i);
  });
});
