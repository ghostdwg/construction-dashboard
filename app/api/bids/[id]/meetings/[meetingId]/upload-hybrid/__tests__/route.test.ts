// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/meetings/[meetingId]/upload-hybrid/__tests__/route.test.ts
//
//  Artifact-durability coverage: the route used to write directly to
//  process.cwd()/uploads/meetings/{meetingId}/{audioFile.name} — container-
//  ephemeral storage — storing only the bare filename in Meeting.audioFileName.
//  It now persists through BlobStore under a relative key
//  (uploads/meetings/{meetingId}/{safe name}), and the new nullable
//  Meeting.audioStorageKey column stores ONLY that relative key.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type MeetingRow = {
  id: number;
  bidId: number;
  status: string;
  audioFileName: string | null;
  audioStorageKey: string | null;
};

const db = {
  meeting: null as MeetingRow | null,
  updates: [] as Array<Partial<MeetingRow>>,
};

function resetDb() {
  db.meeting = null;
  db.updates = [];
  blobData.clear();
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: {
      findFirst: vi.fn(async () => db.meeting),
      update: vi.fn(async ({ data }: { data: Partial<MeetingRow> }) => {
        db.updates.push(data);
        if (db.meeting) Object.assign(db.meeting, data);
        return db.meeting;
      }),
    },
  },
}));

const blobData = new Map<string, Buffer>();
const blobPutMock = vi.fn(async (key: string, data: Buffer) => {
  blobData.set(key, data);
  return { size: data.length, sha256: "fake-sha", storedAt: "2026-01-01T00:00:00.000Z" };
});
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({
    put: blobPutMock,
    get: vi.fn(async () => Buffer.from("")),
    exists: vi.fn(async (key: string) => blobData.has(key)),
    delete: vi.fn(async (key: string) => blobData.delete(key)),
    stat: vi.fn(async () => null),
  }),
  localPathForKey: vi.fn((key: string) => `/storage/${key}`),
  safeBlobFileName: (fileName: string) => {
    const base = fileName.split("/").pop()!.trim();
    return base.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180) || "upload.bin";
  },
}));

function uploadRequest(vttText: string, audioName: string) {
  const form = new FormData();
  form.append("vtt", new File([vttText], "transcript.vtt", { type: "text/vtt" }));
  form.append("audio", new File([new Uint8Array(Buffer.from("fake audio bytes"))], audioName, { type: "audio/wav" }));
  return new Request("http://localhost/api/bids/1/meetings/9/upload-hybrid", { method: "POST", body: form });
}

const routeParams = { params: Promise.resolve({ id: "1", meetingId: "9" }) };

describe("POST /api/bids/[id]/meetings/[meetingId]/upload-hybrid", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    db.meeting = { id: 9, bidId: 1, status: "PENDING", audioFileName: null, audioStorageKey: null };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("persists the audio through BlobStore under the production-matching relative key, storing ONLY that relative key in audioStorageKey", async () => {
    const { POST } = await import("../route");
    const res = await POST(uploadRequest("WEBVTT\n\n<v Alice>hello", "Meeting Recording #1.wav"), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(blobPutMock).toHaveBeenCalledWith("uploads/meetings/9/Meeting Recording _1.wav", expect.any(Buffer));

    const finalUpdate = db.updates[db.updates.length - 1];
    expect(finalUpdate.audioStorageKey).toBe("uploads/meetings/9/Meeting Recording _1.wav");
    expect(finalUpdate.audioStorageKey!.startsWith("/")).toBe(false);
    // audioFileName stores the same sanitized name, so historic-row fallback
    // reconstruction and the new key always agree on the on-disk filename.
    expect(finalUpdate.audioFileName).toBe("Meeting Recording _1.wav");
  });

  test("invalid VTT (missing WEBVTT header) is rejected before any BlobStore write", async () => {
    const { POST } = await import("../route");
    const res = await POST(uploadRequest("not a vtt file", "audio.wav"), routeParams);
    expect(res.status).toBe(400);
    expect(blobPutMock).not.toHaveBeenCalled();
  });

  test("meeting not found under this bid returns 404", async () => {
    db.meeting = null;
    const { POST } = await import("../route");
    const res = await POST(uploadRequest("WEBVTT\n\n<v Alice>hi", "audio.wav"), routeParams);
    expect(res.status).toBe(404);
  });
});
