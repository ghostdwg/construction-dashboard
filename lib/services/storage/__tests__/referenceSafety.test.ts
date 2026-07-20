import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const refs = vi.hoisted(() => ({
  drawings: [] as Array<{ bidId: number; filePath: string }>,
  addenda: [] as Array<{ bidId: number; storageKey: string | null }>,
  meetings: [] as Array<{ id: number; bidId: number; audioStorageKey: string | null }>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    drawingUpload: { findMany: vi.fn(async () => refs.drawings) },
    addendumUpload: { findMany: vi.fn(async () => refs.addenda) },
    meeting: { findMany: vi.fn(async () => refs.meetings) },
  },
}));

import { getBlobStore, resetBlobStoreSingleton } from "@/lib/storage/blobStore";
import {
  deleteAddendumStorageIfUnreferenced,
  deleteDrawingStorageIfUnreferenced,
  deleteMeetingStorageIfUnreferenced,
} from "../referenceSafety";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "storage-reference-safety-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
  resetBlobStoreSingleton();
});

beforeEach(() => {
  refs.drawings = [];
  refs.addenda = [];
  refs.meetings = [];
});

afterAll(() => {
  resetBlobStoreSingleton();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("reference-aware storage retirement", () => {
  test("deletes an unreferenced canonical drawing", async () => {
    const key = "plan-room/jobs/1/drawings/12345678/plan.pdf";
    await getBlobStore().put(key, Buffer.from("drawing"));
    await expect(deleteDrawingStorageIfUnreferenced(key, 1)).resolves.toBe(true);
    await expect(getBlobStore().exists(key)).resolves.toBe(false);
  });

  test("preserves a shared addendum blob", async () => {
    const key = "uploads/addendums/1/shared.pdf";
    await getBlobStore().put(key, Buffer.from("shared"));
    refs.addenda = [{ bidId: 1, storageKey: key }];
    await expect(deleteAddendumStorageIfUnreferenced(key, 1)).resolves.toBe(false);
    await expect(getBlobStore().exists(key)).resolves.toBe(true);
  });

  test("an exact malformed cross-scope meeting reference still protects bytes", async () => {
    const key = "plan-room/jobs/1/meetings/9/12345678/audio.wav";
    await getBlobStore().put(key, Buffer.from("meeting"));
    refs.meetings = [{ id: 99, bidId: 2, audioStorageKey: key }];
    await expect(deleteMeetingStorageIfUnreferenced(key, 1, 9)).resolves.toBe(false);
    await expect(getBlobStore().exists(key)).resolves.toBe(true);
  });

  test("an absolute storage-root alias protects the same blob", async () => {
    const key = "plan-room/jobs/1/meetings/10/12345678/audio.wav";
    await getBlobStore().put(key, Buffer.from("meeting"));
    refs.meetings = [
      { id: 999, bidId: 2, audioStorageKey: path.join(storageRoot, key) },
    ];
    await expect(deleteMeetingStorageIfUnreferenced(key, 1, 10)).resolves.toBe(false);
    await expect(getBlobStore().exists(key)).resolves.toBe(true);
  });
});
