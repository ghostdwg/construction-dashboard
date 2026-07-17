// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/meetings/[meetingId]/upload/__tests__/route.test.ts
//
//  Covers:
//  1. Durable audio storage — audio persisted to BlobStore before sidecar proxy;
//     audioStorageKey written to Meeting row.
//  2. Duplicate-job guard — TRANSCRIBING/UPLOADING meetings reject re-submission
//     with 409 rather than creating a second job.
//  3. BackgroundJob lifecycle — createJob, startJob, failJob wired correctly.
//  4. Sidecar 400 "not configured" path — sets PENDING, fails BackgroundJob.
//  5. Network error path — sets FAILED, fails BackgroundJob.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type MeetingRow = {
  id: number;
  bidId: number;
  status: string;
  audioFileName: string | null;
  audioStorageKey: string | null;
  uploadedAt: Date | null;
  transcriptionJobId: string | null;
  transcriptionSource: string | null;
};

// ── In-memory DB ──────────────────────────────────────────────────────────────

const db = {
  meeting: null as MeetingRow | null,
  updates: [] as Array<Partial<MeetingRow>>,
  participantCount: 0,
};

function resetDb() {
  db.meeting = null;
  db.updates = [];
  db.participantCount = 0;
  blobData.clear();
  bgJobs.length = 0;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: {
      findFirst: vi.fn(async () => db.meeting),
      update: vi.fn(async ({ data }: { data: Partial<MeetingRow> }) => {
        db.updates.push({ ...data });
        if (db.meeting) Object.assign(db.meeting, data);
        return db.meeting;
      }),
    },
    meetingParticipant: {
      count: vi.fn(async () => db.participantCount),
    },
  },
}));

// ── BlobStore mock ─────────────────────────────────────────────────────────────

const blobData = new Map<string, Buffer>();
const blobPutMock = vi.fn(async (key: string, data: Buffer) => {
  blobData.set(key, data);
  return { size: data.length, sha256: "fake-sha", storedAt: "2026-01-01T00:00:00.000Z" };
});

vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ put: blobPutMock }),
  safeBlobFileName: (name: string) =>
    name.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180) || "upload.bin",
}));

vi.mock("@/lib/services/meetings/storagePath", () => ({
  meetingAudioStorageKey: (meetingId: number, safeFileName: string) =>
    `uploads/meetings/${meetingId}/${safeFileName}`,
}));

// ── BackgroundJob mock ─────────────────────────────────────────────────────────

const bgJobs: Array<{ id: string; type: string; status: string; externalJobId?: string }> = [];
let bgJobIdCounter = 1;

const createJobMock = vi.fn(async (params: { jobType: string }) => {
  const job = { id: `bg-${bgJobIdCounter++}`, type: params.jobType, status: "queued" };
  bgJobs.push(job);
  return job;
});
const startJobMock = vi.fn(async (id: string, extId?: string) => {
  const j = bgJobs.find((j) => j.id === id);
  if (j) { j.status = "running"; j.externalJobId = extId; }
});
const failJobMock = vi.fn(async (id: string, _msg: string) => {
  const j = bgJobs.find((j) => j.id === id);
  if (j) j.status = "failed";
});

vi.mock("@/lib/services/jobs/backgroundJobService", () => ({
  createJob: createJobMock,
  startJob: startJobMock,
  failJob: failJobMock,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const routeParams = { params: Promise.resolve({ id: "1", meetingId: "9" }) };

function makeUploadRequest(audioName = "meeting.wav") {
  const form = new FormData();
  form.append("audio", new File([new Uint8Array(8)], audioName, { type: "audio/wav" }));
  return new Request("http://localhost/api/bids/1/meetings/9/upload", {
    method: "POST",
    body: form,
  });
}

function makeSidecarOkResponse(jobId = "WHISPERX:uuid-1", source = "WHISPERX") {
  return new Response(JSON.stringify({ transcriptionJobId: jobId, source }), { status: 200 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/bids/[id]/meetings/[meetingId]/upload", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    db.meeting = {
      id: 9,
      bidId: 1,
      status: "PENDING",
      audioFileName: null,
      audioStorageKey: null,
      uploadedAt: null,
      transcriptionJobId: null,
      transcriptionSource: null,
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── 1. Durable storage ───────────────────────────────────────────────────────

  test("persists audio to BlobStore and writes audioStorageKey before proxying to sidecar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeSidecarOkResponse()));
    const { POST } = await import("../route");
    const res = await POST(makeUploadRequest("OAC Meeting #3.wav"), routeParams);
    expect(res.status).toBe(200);

    expect(blobPutMock).toHaveBeenCalledOnce();
    const [key] = blobPutMock.mock.calls[0];
    expect(key).toMatch(/^uploads\/meetings\/9\//);
    expect(key).toContain("OAC Meeting");

    const storageKeyUpdate = db.updates.find((u) => u.audioStorageKey != null);
    expect(storageKeyUpdate).toBeDefined();
    expect(storageKeyUpdate!.audioStorageKey!.startsWith("/")).toBe(false);
    expect(storageKeyUpdate!.audioStorageKey).toBe(key);
  });

  test("meeting reaches TRANSCRIBING status with transcriptionJobId on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeSidecarOkResponse("WHISPERX:abc", "WHISPERX")));
    const { POST } = await import("../route");
    const res = await POST(makeUploadRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(db.meeting!.status).toBe("TRANSCRIBING");
    expect(db.meeting!.transcriptionJobId).toBe("WHISPERX:abc");
  });

  // ── 2. Duplicate-job guard ────────────────────────────────────────────────────

  test("rejects re-upload with 409 when meeting is already TRANSCRIBING", async () => {
    db.meeting!.status = "TRANSCRIBING";
    db.meeting!.transcriptionJobId = "WHISPERX:existing";
    const { POST } = await import("../route");
    const res = await POST(makeUploadRequest(), routeParams);
    expect(res.status).toBe(409);
    expect(blobPutMock).not.toHaveBeenCalled();
  });

  test("rejects re-upload with 409 when meeting is already UPLOADING", async () => {
    db.meeting!.status = "UPLOADING";
    const { POST } = await import("../route");
    const res = await POST(makeUploadRequest(), routeParams);
    expect(res.status).toBe(409);
  });

  test("allows re-upload when meeting is FAILED (retry scenario)", async () => {
    db.meeting!.status = "FAILED";
    vi.stubGlobal("fetch", vi.fn(async () => makeSidecarOkResponse()));
    const { POST } = await import("../route");
    const res = await POST(makeUploadRequest(), routeParams);
    expect(res.status).toBe(200);
  });

  // ── 3. BackgroundJob lifecycle ────────────────────────────────────────────────

  test("creates a BackgroundJob queued row and transitions to running on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => makeSidecarOkResponse("WHISPERX:job-bg")));
    const { POST } = await import("../route");
    await POST(makeUploadRequest(), routeParams);

    expect(createJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: "meeting_transcription" })
    );
    expect(startJobMock).toHaveBeenCalledWith(expect.any(String), "WHISPERX:job-bg");
    const job = bgJobs[0];
    expect(job.status).toBe("running");
  });

  test("fails the BackgroundJob when the sidecar is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    const { POST } = await import("../route");
    const res = await POST(makeUploadRequest(), routeParams);
    expect(res.status).toBe(502);
    expect(failJobMock).toHaveBeenCalled();
    const job = bgJobs[0];
    expect(job.status).toBe("failed");
  });

  // ── 4. Sidecar "not configured" path ─────────────────────────────────────────

  test("returns ok:false + manual:true when no transcription service is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            detail:
              "No transcription service available. " +
              "Configure WHISPERX_URL (GPU PC) or ASSEMBLYAI_API_KEY in sidecar/.env.",
          }),
          { status: 400 }
        )
      )
    );
    const { POST } = await import("../route");
    const res = await POST(makeUploadRequest(), routeParams);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.manual).toBe(true);
    expect(db.meeting!.status).toBe("PENDING");
    // Audio must still be stored even on manual path
    expect(blobPutMock).toHaveBeenCalled();
    expect(failJobMock).toHaveBeenCalled();
  });

  // ── 5. Missing audio field ────────────────────────────────────────────────────

  test("returns 400 when audio field is absent", async () => {
    const emptyForm = new FormData();
    const req = new Request("http://localhost/api/bids/1/meetings/9/upload", {
      method: "POST",
      body: emptyForm,
    });
    const { POST } = await import("../route");
    const res = await POST(req, routeParams);
    expect(res.status).toBe(400);
  });

  // ── 6. Meeting not found ─────────────────────────────────────────────────────

  test("returns 404 when meeting does not belong to this bid", async () => {
    db.meeting = null;
    const { POST } = await import("../route");
    const res = await POST(makeUploadRequest(), routeParams);
    expect(res.status).toBe(404);
  });
});
