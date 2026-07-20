import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  prismaCalls: 0,
  meeting: null as null | {
    id: number;
    status: string;
    transcriptionJobId: string | null;
    processingMode: string;
    vttContent: string | null;
    speakerMapping: string | null;
    transcript: string | null;
    rawTranscript: string | null;
    durationSeconds: number | null;
  },
  jobLookupFailure: false,
  participants: [] as Array<{ speakerLabel: string }>,
}));

const mocks = vi.hoisted(() => ({
  requireBidAccess: vi.fn(),
  findFirst: vi.fn(),
  meetingUpdate: vi.fn(),
  meetingUpdateMany: vi.fn(),
  participantFindMany: vi.fn(),
  participantCreateMany: vi.fn(),
  transaction: vi.fn(),
  findJobByExternalId: vi.fn(),
  completeJob: vi.fn(),
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
          update: mocks.meetingUpdate,
          updateMany: mocks.meetingUpdateMany,
        },
        meetingParticipant: {
          findMany: mocks.participantFindMany,
          createMany: mocks.participantCreateMany,
        },
      }),
    };
  }),
}));

vi.mock("@/lib/services/meetingRegister/txAudit", () => ({
  writeRegisterAuditTx: vi.fn(async (_tx, args) => args),
  emitRegisterAuditPostCommit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    meeting: {
      update: mocks.meetingUpdate,
      updateMany: mocks.meetingUpdateMany,
    },
    meetingParticipant: {
      findMany: mocks.participantFindMany,
      createMany: mocks.participantCreateMany,
    },
  };
  return {
    prisma: {
      meeting: {
        findFirst: mocks.findFirst,
        update: mocks.meetingUpdate,
        updateMany: mocks.meetingUpdateMany,
      },
      meetingParticipant: tx.meetingParticipant,
      $transaction: mocks.transaction.mockImplementation(
        async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)
      ),
    },
  };
});

vi.mock("@/lib/services/jobs/backgroundJobService", () => ({
  findJobByExternalId: mocks.findJobByExternalId,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
}));

import { GET } from "../route";

const routeParams = {
  params: Promise.resolve({ id: "1", meetingId: "9" }),
};

function jsonResponse(body: unknown, status = 200) {
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
  state.jobLookupFailure = false;
  state.meeting = {
    id: 9,
    status: "TRANSCRIBING",
    transcriptionJobId: "WHISPERX:worker-1",
    processingMode: "AUTO",
    vttContent: null,
    speakerMapping: null,
    transcript: null,
    rawTranscript: null,
    durationSeconds: null,
  };
  state.participants = [];
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
  mocks.meetingUpdate.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => {
      state.prismaCalls += 1;
      if (state.meeting) Object.assign(state.meeting, data);
      return state.meeting;
    }
  );
  mocks.meetingUpdateMany.mockImplementation(
    async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      state.prismaCalls += 1;
      if (
        !state.meeting ||
        state.meeting.status !== where.status ||
        state.meeting.transcriptionJobId !== where.transcriptionJobId
      ) {
        return { count: 0 };
      }
      Object.assign(state.meeting, data);
      return { count: 1 };
    }
  );
  mocks.participantFindMany.mockImplementation(async () => state.participants);
  mocks.participantCreateMany.mockImplementation(
    async ({ data }: { data: Array<{ speakerLabel: string }> }) => {
      state.participants.push(...data.map((row) => ({ speakerLabel: row.speakerLabel })));
      return { count: data.length };
    }
  );
  mocks.findJobByExternalId.mockImplementation(async () => {
    if (state.jobLookupFailure) throw new Error("job table unavailable");
    return { id: "bg-1" };
  });
  mocks.completeJob.mockResolvedValue(undefined);
  mocks.failJob.mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse({ status: "processing" }))
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("authorization and service authentication", () => {
  it("denies before DB, Sidecar, or BackgroundJob work", async () => {
    state.denied = true;

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(result.status).toBe(403);
    expect(state.prismaCalls).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.findJobByExternalId).not.toHaveBeenCalled();
  });

  it("fails closed without a Sidecar key outside local mode", async () => {
    vi.stubEnv("APP_ENV", "staging");

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(result.status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.findJobByExternalId).not.toHaveBeenCalled();
  });

  it("propagates the configured Sidecar key to status polling", async () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("SIDECAR_API_KEY", "synthetic-sidecar-key");

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(result.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/meetings/transcribe/status/WHISPERX:worker-1"),
      { headers: { "X-API-Key": "synthetic-sidecar-key" } }
    );
  });
});

describe("meeting and BackgroundJob terminal state", () => {
  it("keeps processing jobs running", async () => {
    const result = await GET(new Request("http://local/status"), routeParams);

    expect(await result.json()).toEqual({ status: "TRANSCRIBING" });
    expect(mocks.completeJob).not.toHaveBeenCalled();
    expect(mocks.failJob).not.toHaveBeenCalled();
  });

  it("completes meeting and tracked job from the flat completed payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "completed",
          transcript: "[00:01] SPEAKER_00: Synthetic meeting",
          rawTranscript: '{"segments":[]}',
          durationSeconds: 12,
          participants: [],
        })
      )
    );

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(await result.json()).toEqual({ status: "READY" });
    expect(state.meeting?.status).toBe("READY");
    expect(mocks.meetingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 9,
          bidId: 1,
          status: "TRANSCRIBING",
          transcriptionJobId: "WHISPERX:worker-1",
          reviewStatus: { not: "PUBLISHED" },
          rawTranscript: null,
        },
      })
    );
    expect(mocks.findJobByExternalId).toHaveBeenCalledWith(
      "WHISPERX:worker-1",
      1
    );
    expect(mocks.completeJob).toHaveBeenCalledWith("bg-1", {
      resultSummary: "transcript ready",
    });
  });

  it("marks meeting and tracked job failed on worker-restart recovery", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "error",
          error: "WhisperX worker restarted — job lost",
        })
      )
    );

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(await result.json()).toEqual({
      status: "FAILED",
      error: "WhisperX worker restarted — job lost",
    });
    expect(state.meeting?.status).toBe("FAILED");
    expect(mocks.failJob).toHaveBeenCalledWith(
      "bg-1",
      "WhisperX worker restarted — job lost"
    );
  });

  it("surfaces durable failure-reconciliation loss instead of reporting false success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ status: "error", error: "provider failed" })
      )
    );
    mocks.failJob.mockRejectedValueOnce(
      Object.assign(new Error("job cleanup exhausted"), {
        code: "BACKGROUND_JOB_RECONCILIATION_REQUIRED",
      })
    );

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      error: "Transcription result committed, but durable job reconciliation is required",
      code: "BACKGROUND_JOB_RECONCILIATION_REQUIRED",
      reconciliationRequired: true,
    });
    expect(state.meeting?.status).toBe("FAILED");
  });

  it("allows one concurrent completion winner and preserves its source/participants/job outcome", async () => {
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          await firstBlocked;
          return jsonResponse({
            status: "completed",
            transcript: "losing transcript",
            rawTranscript: '{"source":"loser"}',
            durationSeconds: 10,
            participants: [
              { speakerLabel: "SPEAKER_00", name: "Loser", wordCount: 1 },
            ],
          });
        }
        return jsonResponse({
          status: "completed",
          transcript: "winning transcript",
          rawTranscript: '{"source":"winner"}',
          durationSeconds: 20,
          participants: [
            { speakerLabel: "SPEAKER_00", name: "Winner", wordCount: 2 },
            { speakerLabel: "SPEAKER_00", name: "Duplicate", wordCount: 2 },
            { speakerLabel: "SPEAKER_01", name: "Second", wordCount: 1 },
          ],
        });
      })
    );

    const losingPoll = GET(new Request("http://local/status"), routeParams);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const winningResponse = await GET(
      new Request("http://local/status"),
      routeParams
    );
    releaseFirst();
    const losingResponse = await losingPoll;

    expect(await winningResponse.json()).toEqual({ status: "READY" });
    expect(await losingResponse.json()).toEqual({ status: "READY" });
    expect(state.meeting?.rawTranscript).toBe('{"source":"winner"}');
    expect(state.meeting?.transcript).toBe("winning transcript");
    expect(state.meeting?.durationSeconds).toBe(20);
    expect(state.participants).toEqual([
      { speakerLabel: "SPEAKER_00" },
      { speakerLabel: "SPEAKER_01" },
    ]);
    expect(mocks.participantCreateMany).toHaveBeenCalledOnce();
    expect(mocks.completeJob).toHaveBeenCalledOnce();
    expect(mocks.failJob).not.toHaveBeenCalled();
  });

  it("lets a completion winner defeat a stale concurrent error", async () => {
    let releaseError!: () => void;
    const errorBlocked = new Promise<void>((resolve) => {
      releaseError = resolve;
    });
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          await errorBlocked;
          return jsonResponse({ status: "error", error: "stale worker error" });
        }
        return jsonResponse({
          status: "completed",
          transcript: "authoritative transcript",
          rawTranscript: '{"source":"authoritative"}',
          durationSeconds: 30,
          participants: [],
        });
      })
    );

    const staleErrorPoll = GET(new Request("http://local/status"), routeParams);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const completionResponse = await GET(
      new Request("http://local/status"),
      routeParams
    );
    releaseError();
    const staleErrorResponse = await staleErrorPoll;

    expect(await completionResponse.json()).toEqual({ status: "READY" });
    expect(await staleErrorResponse.json()).toEqual({ status: "READY" });
    expect(state.meeting?.rawTranscript).toBe('{"source":"authoritative"}');
    expect(mocks.completeJob).toHaveBeenCalledOnce();
    expect(mocks.failJob).not.toHaveBeenCalled();
  });

  it("uses the same conditional winner for hybrid completion", async () => {
    state.meeting!.transcriptionJobId = "HYBRID:WHISPERX:hybrid-1";
    state.meeting!.vttContent = "WEBVTT\n\n<v Alice>hello";
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1;
        if (fetchCount === 1) {
          return jsonResponse({
            status: "completed",
            transcript: "diarized",
            rawTranscript: '{"segments":[]}',
            durationSeconds: 40,
            participants: [],
          });
        }
        return jsonResponse({
          ok: true,
          transcript: "merged",
          participants: [
            { speakerLabel: "SPEAKER_00", name: "Alice", wordCount: 1 },
          ],
          clusters: [
            {
              id: "SPEAKER_00",
              type: "IN_ROOM",
              resolvedName: null,
              totalSeconds: 4,
              segmentCount: 1,
            },
          ],
          durationSeconds: 40,
        });
      })
    );

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(await result.json()).toEqual({ status: "AWAITING_NAMES" });
    expect(mocks.meetingUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          transcriptionJobId: "HYBRID:WHISPERX:hybrid-1",
          status: "TRANSCRIBING",
        }),
      })
    );
    expect(state.meeting?.rawTranscript).toBe('{"segments":[]}');
    expect(state.meeting?.vttContent).toBeNull();
    expect(mocks.completeJob).toHaveBeenCalledOnce();
  });

  it("uses the same conditional winner for hybrid merge fallback", async () => {
    state.meeting!.transcriptionJobId = "HYBRID:WHISPERX:hybrid-1";
    state.meeting!.vttContent = "WEBVTT\n\n<v Alice>hello";
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCount += 1;
        return fetchCount === 1
          ? jsonResponse({
              status: "completed",
              transcript: "fallback transcript",
              rawTranscript: '{"segments":[]}',
              durationSeconds: 40,
              participants: [],
            })
          : jsonResponse({ detail: "merge unavailable" }, 503);
      })
    );

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(await result.json()).toEqual({ status: "READY" });
    expect(state.meeting?.transcript).toBe("fallback transcript");
    expect(state.meeting?.vttContent).toBeNull();
    expect(mocks.completeJob).toHaveBeenCalledOnce();
  });

  it("preserves completed meeting state but reports reconciliation when job lookup fails", async () => {
    state.jobLookupFailure = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          status: "completed",
          transcript: "synthetic",
          rawTranscript: "{}",
          durationSeconds: 1,
          participants: [],
        })
      )
    );

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({
      error: "Transcription result committed, but durable job reconciliation is required",
      code: "BACKGROUND_JOB_RECONCILIATION_REQUIRED",
      reconciliationRequired: true,
    });
    expect(state.meeting?.status).toBe("READY");
  });

  it("leaves meeting/job running on non-404 Sidecar transport errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ detail: "temporary upstream failure" }, 503))
    );

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(result.status).toBe(502);
    expect(state.meeting?.status).toBe("TRANSCRIBING");
    expect(mocks.completeJob).not.toHaveBeenCalled();
    expect(mocks.failJob).not.toHaveBeenCalled();
  });

  it("returns a stored terminal state without polling Sidecar", async () => {
    state.meeting!.status = "READY";
    state.meeting!.transcriptionJobId = null;

    const result = await GET(new Request("http://local/status"), routeParams);

    expect(await result.json()).toEqual({ status: "READY" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
