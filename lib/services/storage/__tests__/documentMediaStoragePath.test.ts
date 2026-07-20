import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { getBlobStore, resetBlobStoreSingleton } from "@/lib/storage/blobStore";
import {
  classifyDrawingStoragePath,
  drawingStorageKey,
  readDrawingStorageBuffer,
} from "@/lib/services/drawings/storagePath";
import {
  addendumStorageKey,
  classifyAddendumStoragePath,
  readAddendumStorageBuffer,
} from "@/lib/services/addendums/storagePath";
import {
  classifyMeetingStoragePath,
  MEETING_MEDIA_MAX_BYTES,
  meetingAudioStorageKey,
  readMeetingStorageBuffer,
  validateMeetingMediaUpload,
} from "@/lib/services/meetings/storagePath";

let storageRoot: string;

beforeAll(() => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "document-media-storage-path-"));
  process.env.STORAGE_BACKEND = "local";
  process.env.STORAGE_LOCAL_PATH = storageRoot;
  resetBlobStoreSingleton();
});

afterAll(() => {
  resetBlobStoreSingleton();
  fs.rmSync(storageRoot, { recursive: true, force: true });
});

describe("canonical document/media key families", () => {
  test("generated keys are bid-scoped, normalized, and user segments are filenames only", () => {
    expect(drawingStorageKey(7, "12345678", "plan.pdf")).toBe(
      "plan-room/jobs/7/drawings/12345678/plan.pdf",
    );
    expect(addendumStorageKey(7, "12345678", "addendum.pdf")).toBe(
      "plan-room/jobs/7/addenda/12345678/addendum.pdf",
    );
    expect(meetingAudioStorageKey(7, 11, "12345678", "audio.wav")).toBe(
      "plan-room/jobs/7/meetings/11/12345678/audio.wav",
    );
  });

  test("meeting media validation rejects empty, oversized, and unsupported uploads", () => {
    expect(
      validateMeetingMediaUpload({ fileName: "audio.wav", mimeType: "audio/wav", byteSize: 0 }),
    ).toMatchObject({ ok: false });
    expect(
      validateMeetingMediaUpload({
        fileName: "audio.wav",
        mimeType: "audio/wav",
        byteSize: MEETING_MEDIA_MAX_BYTES + 1,
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateMeetingMediaUpload({ fileName: "payload.html", mimeType: "text/html", byteSize: 10 }),
    ).toMatchObject({ ok: false });
    expect(
      validateMeetingMediaUpload({ fileName: "meeting.webm", mimeType: "video/webm", byteSize: 10 }),
    ).toEqual({ ok: true });
  });

  test("cross-bid, cross-meeting, traversal, and cross-domain references are invalid", () => {
    expect(
      classifyDrawingStoragePath("plan-room/jobs/8/drawings/x/plan.pdf", 7).kind,
    ).toBe("invalid");
    expect(
      classifyAddendumStoragePath("plan-room/jobs/7/drawings/x/plan.pdf", 7).kind,
    ).toBe("invalid");
    expect(
      classifyMeetingStoragePath("plan-room/jobs/7/meetings/12/x/audio.wav", 7, 11).kind,
    ).toBe("invalid");
    expect(classifyDrawingStoragePath("../../etc/passwd", 7).kind).toBe("invalid");
  });
});

describe("legacy relative BlobStore compatibility", () => {
  test("reads old drawing, addendum, and meeting key families without migration", async () => {
    const store = getBlobStore();
    await store.put("uploads/drawings/7/legacy.pdf", Buffer.from("drawing"));
    await store.put("uploads/addendums/7/legacy.pdf", Buffer.from("addendum"));
    await store.put("uploads/meetings/11/legacy.wav", Buffer.from("meeting"));

    await expect(readDrawingStorageBuffer("uploads/drawings/7/legacy.pdf", 7)).resolves.toEqual(
      Buffer.from("drawing"),
    );
    await expect(readAddendumStorageBuffer("uploads/addendums/7/legacy.pdf", 7)).resolves.toEqual(
      Buffer.from("addendum"),
    );
    await expect(readMeetingStorageBuffer("uploads/meetings/11/legacy.wav", 7, 11)).resolves.toEqual(
      Buffer.from("meeting"),
    );
  });

  test("old relative families remain strictly scoped", () => {
    expect(classifyDrawingStoragePath("uploads/drawings/8/legacy.pdf", 7).kind).toBe("invalid");
    expect(classifyAddendumStoragePath("uploads/addendums/8/legacy.pdf", 7).kind).toBe("invalid");
    expect(classifyMeetingStoragePath("uploads/meetings/12/legacy.wav", 7, 11).kind).toBe("invalid");
  });
});
