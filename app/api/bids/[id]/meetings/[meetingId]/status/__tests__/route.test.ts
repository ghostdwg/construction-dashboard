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
  },
  jobLookupFailure: false,
}));

const mocks = vi.hoisted(() => ({
  requireBidAccess: vi.fn(),
  findFirst: vi.fn(),
  meetingUpdate: vi.fn(),
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

vi.mock("@/lib/prisma", () => {
  const tx = {
    meeting: { update: mocks.meetingUpdate },
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
  mocks.meetingUpdate.mockImplementation(
    async ({ data }: { data: Record<string, unknown> }) => {
      state.prismaCalls += 1;
      if (state.meeting) Object.assign(state.meeting, data);
      return state.meeting;
    }
  );
  mocks.participantFindMany.mockResolvedValue([]);
  mocks.participantCreateMany.mockResolvedValue({ count: 0 });
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

  it("does not corrupt completed meeting state when job lookup fails", async () => {
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

    expect(result.status).toBe(200);
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
