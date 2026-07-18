import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  meeting: null as null | {
    id: number;
    bidId: number;
    status: string;
    audioFileName: string | null;
    audioStorageKey: string | null;
    transcriptionJobId: string | null;
    transcriptionSource: string | null;
    reviewStatus: string;
    rawTranscript: string | null;
    analyzedAt: Date | null;
  },
  prismaCalls: 0,
  blobs: new Map<string, Buffer>(),
  storageFailure: false,
  createJobFailure: false,
  startJobFailure: false,
  pointerPersistenceFailure: false,
  deleteFailure: false,
}));

const mocks = vi.hoisted(() => ({
  requireBidAccess: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  updateMany: vi.fn(),
  participantCount: vi.fn(),
  blobExists: vi.fn(),
  blobPut: vi.fn(),
  blobDelete: vi.fn(),
  createJob: vi.fn(),
  startJob: vi.fn(),
  failJob: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: mocks.requireBidAccess,
}));

vi.mock("@/lib/services/meetingRegister/retention", () => ({
  FROZEN_TRANSCRIPT_CONFLICT: "frozen transcript",
  meetingTranscriptMutationGate: vi.fn(async () =>
    state.meeting ? { ok: true } : { ok: false, reason: "not-found" }
  ),
  withMutableMeetingTranscript: vi.fn(async (_bidId, _meetingId, mutate) => {
    if (!state.meeting) return { ok: false, reason: "not-found" };
    return {
      ok: true,
      value: await mutate({
        meeting: {
          findFirst: mocks.findFirst,
          update: mocks.update,
          updateMany: mocks.updateMany,
        },
      }),
    };
  }),
}));

vi.mock("@/lib/services/meetingRegister/txAudit", () => ({
  writeRegisterAuditTx: vi.fn(async (_tx, args) => args),
  emitRegisterAuditPostCommit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: {
      findFirst: mocks.findFirst,
      update: mocks.update,
      updateMany: mocks.updateMany,
    },
    meetingParticipant: { count: mocks.participantCount },
  },
}));

vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({
    exists: mocks.blobExists,
    put: mocks.blobPut,
    delete: mocks.blobDelete,
  }),
  safeBlobFileName: (name: string) =>
    name
      .split(/[\\/]/)
      .pop()!
      .trim()
      .replace(/[^A-Za-z0-9._() -]/g, "_")
      .slice(0, 180) || "upload.bin",
}));

vi.mock("@/lib/services/meetings/storagePath", () => ({
  meetingAudioStorageKey: (meetingId: number, fileName: string) =>
    `uploads/meetings/${meetingId}/${fileName}`,
}));

vi.mock("@/lib/services/jobs/backgroundJobService", () => ({
  createJob: mocks.createJob,
  startJob: mocks.startJob,
  failJob: mocks.failJob,
}));

import { POST } from "../route";

const routeParams = {
  params: Promise.resolve({ id: "1", meetingId: "9" }),
};

function uploadRequest(name = "meeting.wav") {
  const form = new FormData();
  form.append(
    "audio",
    new File([Buffer.from("synthetic audio")], name, { type: "audio/wav" })
  );
  return new Request("http://local/api/bids/1/meetings/9/upload", {
    method: "POST",
    body: form,
  });
}

function sidecarResponse(
  body: unknown = {
    transcriptionJobId: "WHISPERX:worker-1",
    source: "WHISPERX",
  },
  status = 200
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("APP_ENV", "local");
  vi.stubEnv("SIDECAR_API_KEY", "");
  state.denied = false;
  state.prismaCalls = 0;
  state.blobs.clear();
  state.storageFailure = false;
  state.createJobFailure = false;
  state.startJobFailure = false;
  state.pointerPersistenceFailure = false;
  state.deleteFailure = false;
  state.meeting = {
    id: 9,
    bidId: 1,
    status: "PENDING",
    audioFileName: null,
    audioStorageKey: null,
    transcriptionJobId: null,
    transcriptionSource: null,
    reviewStatus: "DRAFT",
    rawTranscript: null,
    analyzedAt: null,
  };

  mocks.requireBidAccess.mockImplementation(async () =>
    state.denied
      ? {
          ok: false,
          response: Response.json({ error: "Forbidden" }, { status: 403 }),
        }
      : { ok: true, user: { id: "u1", role: "admin" } }
  );
  mocks.findFirst.mockImplementation(async () => {
    state.prismaCalls += 1;
    return state.meeting;
  });
  mocks.update.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => {
      state.prismaCalls += 1;
      if (data.audioStorageKey && state.pointerPersistenceFailure) {
        throw new Error("pointer persistence unavailable");
      }
      if (state.meeting) Object.assign(state.meeting, data);
      return state.meeting;
    }
  );
  mocks.updateMany.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => {
      state.prismaCalls += 1;
      if (
        !state.meeting ||
        !["PENDING", "FAILED"].includes(state.meeting.status) ||
        state.meeting.reviewStatus === "PUBLISHED" ||
        state.meeting.rawTranscript !== null ||
        state.meeting.analyzedAt !== null
      ) {
        return { count: 0 };
      }
      Object.assign(state.meeting, data);
      return { count: 1 };
    }
  );
  mocks.participantCount.mockImplementation(async () => {
    state.prismaCalls += 1;
    return 0;
  });
  mocks.blobExists.mockImplementation(async (key: string) =>
    state.blobs.has(key)
  );
  mocks.blobPut.mockImplementation(async (key: string, bytes: Buffer) => {
    if (state.storageFailure) throw new Error("storage unavailable");
    state.blobs.set(key, bytes);
    return {
      size: bytes.length,
      sha256: "synthetic-sha",
      storedAt: "2026-07-18T00:00:00.000Z",
    };
  });
  mocks.blobDelete.mockImplementation(async (key: string) => {
    if (state.deleteFailure) throw new Error("synthetic delete failure");
    state.blobs.delete(key);
  });
  mocks.createJob.mockImplementation(async () => {
    if (state.createJobFailure) throw new Error("job table unavailable");
    return { id: "bg-1" };
  });
  mocks.startJob.mockImplementation(async () => {
    if (state.startJobFailure) throw new Error("job update unavailable");
  });
  mocks.failJob.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(async () => sidecarResponse()));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("authorization and service-auth ordering", () => {
  it("denies before form parsing, DB, BlobStore, job tracking, or Sidecar", async () => {
    state.denied = true;
    const request = uploadRequest();
    const formDataSpy = vi.spyOn(request, "formData");

    const response = await POST(request, routeParams);

    expect(response.status).toBe(403);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(state.prismaCalls).toBe(0);
    expect(mocks.blobExists).not.toHaveBeenCalled();
    expect(mocks.blobPut).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails closed outside local mode before request parsing or downstream work", async () => {
    vi.stubEnv("APP_ENV", "staging");
    const request = uploadRequest();
    const formDataSpy = vi.spyOn(request, "formData");

    const response = await POST(request, routeParams);

    expect(response.status).toBe(503);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(state.prismaCalls).toBe(0);
    expect(mocks.blobPut).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends the configured Sidecar key", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SIDECAR_API_KEY", "synthetic-sidecar-key");

    const response = await POST(uploadRequest(), routeParams);

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/meetings/transcribe"),
      expect.objectContaining({
        headers: { "X-API-Key": "synthetic-sidecar-key" },
      })
    );
  });
});

describe("durable immutable audio", () => {
  it("stores bytes and persists a relative server-generated key before Sidecar submission", async () => {
    const response = await POST(uploadRequest("../../OAC #4.wav"), routeParams);

    expect(response.status).toBe(200);
    expect(mocks.blobPut).toHaveBeenCalledOnce();
    const storageKey = mocks.blobPut.mock.calls[0][0] as string;
    expect(storageKey).toMatch(
      /^uploads\/meetings\/9\/[0-9a-f-]{36}-OAC _4\.wav$/
    );
    expect(state.meeting?.audioStorageKey).toBe(storageKey);
    expect(state.meeting?.audioFileName).toBe("OAC _4.wav");
    expect(state.blobs.get(storageKey)?.toString()).toBe("synthetic audio");
    expect(mocks.blobPut.mock.invocationCallOrder[0]).toBeLessThan(
      (fetch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]
    );
  });

  it("FAILED retry allocates a different key and never overwrites prior audio", async () => {
    const priorKey = "uploads/meetings/9/prior-recording.wav";
    state.meeting!.status = "FAILED";
    state.meeting!.audioStorageKey = priorKey;
    state.blobs.set(priorKey, Buffer.from("prior immutable bytes"));

    const response = await POST(uploadRequest("meeting.wav"), routeParams);

    expect(response.status).toBe(200);
    expect(state.meeting?.audioStorageKey).not.toBe(priorKey);
    expect(state.blobs.get(priorKey)?.toString()).toBe("prior immutable bytes");
    expect(state.blobs.size).toBe(2);
  });

  it("manual mode retains durable audio and returns PENDING", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sidecarResponse(
          { detail: "No transcription service available. Configure a provider." },
          400
        )
      )
    );

    const response = await POST(uploadRequest(), routeParams);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.manual).toBe(true);
    expect(state.meeting?.status).toBe("PENDING");
    expect(state.meeting?.audioStorageKey).toMatch(/^uploads\/meetings\/9\//);
    expect(mocks.failJob).toHaveBeenCalledWith(
      "bg-1",
      "No transcription service configured"
    );
  });

  it("storage failure marks FAILED and performs no job or provider work", async () => {
    state.storageFailure = true;

    const response = await POST(uploadRequest(), routeParams);

    expect(response.status).toBe(500);
    expect(state.meeting?.status).toBe("FAILED");
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("compensates only the new blob when pointer persistence fails", async () => {
    const priorKey = "uploads/meetings/9/prior-failed-attempt.wav";
    state.meeting!.audioStorageKey = priorKey;
    state.blobs.set(priorKey, Buffer.from("prior immutable bytes"));
    state.pointerPersistenceFailure = true;

    const response = await POST(uploadRequest(), routeParams);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: "Unable to persist meeting audio reference",
    });
    expect(mocks.blobDelete).toHaveBeenCalledOnce();
    const deletedKey = mocks.blobDelete.mock.calls[0][0] as string;
    expect(deletedKey).not.toBe(priorKey);
    expect(state.blobs.has(deletedKey)).toBe(false);
    expect(state.blobs.get(priorKey)?.toString()).toBe("prior immutable bytes");
    expect(state.meeting?.audioStorageKey).toBe(priorKey);
    expect(state.meeting?.status).toBe("FAILED");
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("emits generic telemetry if new-blob compensation fails", async () => {
    const priorKey = "uploads/meetings/9/prior-failed-attempt.wav";
    state.meeting!.audioStorageKey = priorKey;
    state.blobs.set(priorKey, Buffer.from("prior immutable bytes"));
    state.pointerPersistenceFailure = true;
    state.deleteFailure = true;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(uploadRequest("confidential-name.wav"), routeParams);

    expect(response.status).toBe(500);
    expect(errorSpy).toHaveBeenCalledWith(
      "[meeting-upload] Failed to compensate unreferenced audio blob"
    );
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("confidential-name");
    expect(errorSpy.mock.calls.flat().join(" ")).not.toContain("synthetic audio");
    expect(state.meeting?.audioStorageKey).toBe(priorKey);
    expect(state.blobs.get(priorKey)?.toString()).toBe("prior immutable bytes");
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("duplicate guards and BackgroundJob consistency", () => {
  const frozenCases: Array<{
    name: string;
    status?: string;
    reviewStatus?: string;
    rawTranscript?: string;
    analyzedAt?: Date;
  }> = [
    { name: "UPLOADING", status: "UPLOADING" },
    { name: "TRANSCRIBING", status: "TRANSCRIBING" },
    { name: "READY", status: "READY" },
    { name: "AWAITING_NAMES", status: "AWAITING_NAMES" },
    { name: "ANALYZING", status: "ANALYZING" },
    { name: "published", reviewStatus: "PUBLISHED" },
    { name: "completed raw transcript", rawTranscript: '{"segments":[]}' },
    { name: "previously analyzed meeting", analyzedAt: new Date("2026-07-18") },
  ];

  for (const frozen of frozenCases) {
    it(`returns 409 for ${frozen.name} before form/blob/job/provider work`, async () => {
      if (frozen.status) state.meeting!.status = frozen.status;
      if (frozen.reviewStatus) state.meeting!.reviewStatus = frozen.reviewStatus;
      if (frozen.rawTranscript) state.meeting!.rawTranscript = frozen.rawTranscript;
      if (frozen.analyzedAt) state.meeting!.analyzedAt = frozen.analyzedAt;
      const priorKey = "uploads/meetings/9/frozen-source.wav";
      state.meeting!.audioStorageKey = priorKey;
      state.blobs.set(priorKey, Buffer.from("frozen source bytes"));
      const request = uploadRequest();
      const formDataSpy = vi.spyOn(request, "formData");

      const response = await POST(request, routeParams);

      expect(response.status).toBe(409);
      expect(formDataSpy).not.toHaveBeenCalled();
      expect(state.meeting?.audioStorageKey).toBe(priorKey);
      expect(state.meeting?.rawTranscript).toBe(frozen.rawTranscript ?? null);
      expect(state.blobs.get(priorKey)?.toString()).toBe("frozen source bytes");
      expect(mocks.updateMany).not.toHaveBeenCalled();
      expect(mocks.blobPut).not.toHaveBeenCalled();
      expect(mocks.createJob).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });
  }

  it("repeats the full eligibility predicate in the atomic claim", async () => {
    const request = uploadRequest();
    const originalFormData = request.formData.bind(request);
    vi.spyOn(request, "formData").mockImplementation(async () => {
      state.meeting!.reviewStatus = "PUBLISHED";
      return originalFormData();
    });

    const response = await POST(request, routeParams);

    expect(response.status).toBe(409);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 9,
          bidId: 1,
          status: { in: ["PENDING", "FAILED"] },
          reviewStatus: { not: "PUBLISHED" },
          rawTranscript: null,
          analyzedAt: null,
        }),
      })
    );
    expect(mocks.blobPut).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("creates a queued job and starts it with the prefixed external id", async () => {
    await POST(uploadRequest(), routeParams);

    expect(mocks.createJob).toHaveBeenCalledWith({
      jobType: "meeting_transcription",
      bidId: 1,
      relatedId: "9",
      inputSummary: "meeting 9 audio upload",
      triggerSource: "upload",
    });
    expect(mocks.startJob).toHaveBeenCalledWith("bg-1", "WHISPERX:worker-1");
    expect(state.meeting?.status).toBe("TRANSCRIBING");
  });

  it("marks Meeting and BackgroundJob failed when Sidecar is unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("synthetic connection refusal");
      })
    );

    const response = await POST(uploadRequest(), routeParams);

    expect(response.status).toBe(502);
    expect(state.meeting?.status).toBe("FAILED");
    expect(mocks.failJob).toHaveBeenCalledWith("bg-1", "Sidecar request failed");
  });

  it("does not corrupt successful meeting state when job creation fails", async () => {
    state.createJobFailure = true;

    const response = await POST(uploadRequest(), routeParams);

    expect(response.status).toBe(200);
    expect(state.meeting?.status).toBe("TRANSCRIBING");
    expect(state.meeting?.transcriptionJobId).toBe("WHISPERX:worker-1");
    expect(mocks.startJob).not.toHaveBeenCalled();
  });

  it("does not corrupt successful meeting state when job start tracking fails", async () => {
    state.startJobFailure = true;

    const response = await POST(uploadRequest(), routeParams);

    expect(response.status).toBe(200);
    expect(state.meeting?.status).toBe("TRANSCRIBING");
    expect(mocks.failJob).toHaveBeenCalledWith(
      "bg-1",
      "Unable to link transcription tracking job"
    );
  });

  it("returns 404 for a meeting outside the bid before parsing", async () => {
    state.meeting = null;
    const request = uploadRequest();
    const formDataSpy = vi.spyOn(request, "formData");

    const response = await POST(request, routeParams);

    expect(response.status).toBe(404);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(mocks.blobPut).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
