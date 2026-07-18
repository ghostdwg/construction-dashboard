import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  auditFail: false,
  emitted: [] as unknown[],
  tables: {} as Record<string, Row[]>,
}));

const external = vi.hoisted(() => ({
  getSetting: vi.fn(async () => "synthetic-api-key"),
  blobData: new Map<string, Buffer>(),
  blobPut: vi.fn(async (key: string, bytes: Buffer) => {
    external.blobData.set(key, Buffer.from(bytes));
    return { size: bytes.length, sha256: "synthetic", storedAt: "synthetic" };
  }),
  blobDelete: vi.fn(async (key: string) => external.blobData.delete(key)),
  readMeetingStorageBuffer: vi.fn(async () => Buffer.from("synthetic audio")),
  recordAnalysisRun: vi.fn(async () => ({
    ok: true,
    value: { runId: 77, status: "PREVIEWED" },
  })),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({
    ok: true,
    user: { id: "operator-1", role: "admin" },
  })),
}));

vi.mock("@/lib/observability/audit", () => ({
  buildAuditEnvelope: (input: Row) => ({ ...input, timestamp: "synthetic", actor: input.actor }),
  persistAuditEnvelope: async (db: { auditEvent: { create(args: { data: Row }): Promise<unknown> } }, envelope: Row) =>
    db.auditEvent.create({ data: envelope }),
  emitAuditEnvelopeStdout: (envelope: unknown) => state.emitted.push(envelope),
}));

vi.mock("@/lib/services/meetingRegister/routeHelpers", () => ({
  meetingRouteContext: vi.fn(async (id: string, meetingId: string) => ({
    ok: true,
    bidId: Number(id),
    meetingId: Number(meetingId),
    actor: { name: "Synthetic Operator", email: "operator@example.test" },
  })),
}));

vi.mock("@/lib/services/settings/appSettingsService", () => ({
  getSetting: external.getSetting,
}));

vi.mock("@/lib/services/ai/aiTokenConfig", () => ({
  getMaxTokens: vi.fn(async () => 4096),
}));

vi.mock("@/lib/services/ai/aiUsageLog", () => ({
  logAiUsage: vi.fn(async () => undefined),
  classifyAiFailure: vi.fn(() => "synthetic"),
}));

vi.mock("@/lib/meeting-analysis", () => ({
  getPriorOpenItems: vi.fn(async () => "none"),
  getOutstandingCommitments: vi.fn(async () => "none"),
  getProjectContext: vi.fn(async () => ({ openRfis: [], overdueSubmittals: [], openTasks: [] })),
  parseMeetingAnalysis: vi.fn(() => ({
    section1: { date: "2026-07-18", projectName: "Synthetic", durationMinutes: 1 },
    section2: [],
    section3: "Synthetic",
    section4: [],
    section5: [],
    section6: [],
    section7: [],
    section8: [],
    section9: [],
    section10: [],
  })),
}));

vi.mock("@/lib/services/meetingRegister/extractionRuns", () => ({
  recordAnalysisRun: external.recordAnalysisRun,
}));

vi.mock("@/lib/storage/blobStore", () => ({
  safeBlobFileName: (name: string) => name.replace(/[^A-Za-z0-9._() -]/g, "_"),
  getBlobStore: () => ({
    put: external.blobPut,
    delete: external.blobDelete,
    get: vi.fn(async (key: string) => external.blobData.get(key) ?? null),
    exists: vi.fn(async (key: string) => external.blobData.has(key)),
    stat: vi.fn(async () => null),
  }),
}));

vi.mock("@/lib/services/meetings/storagePath", () => ({
  meetingAudioStorageKey: (meetingId: number, name: string) =>
    `uploads/meetings/${meetingId}/${name}`,
  readMeetingStorageBuffer: external.readMeetingStorageBuffer,
}));

vi.mock("@/lib/prisma", () => {
  const matches = (row: Row, where: Row = {}): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === "meeting" && value && typeof value === "object") {
        const meeting = state.tables.meeting.find((candidate) => candidate.id === row.meetingId);
        return Boolean(meeting && matches(meeting, value as Row));
      }
      if (value && typeof value === "object" && !Array.isArray(value)) return true;
      return row[key] === value;
    });

  const delegate = (name: string) => ({
    count: async (args: { where?: Row } = {}) =>
      (state.tables[name] ?? []).filter((row) => matches(row, args.where)).length,
    findFirst: async (args: { where?: Row } = {}) =>
      (state.tables[name] ?? []).find((row) => matches(row, args.where)) ?? null,
    findUnique: async (args: { where: Row }) =>
      (state.tables[name] ?? []).find((row) => matches(row, args.where)) ?? null,
    findMany: async (args: { where?: Row } = {}) =>
      (state.tables[name] ?? []).filter((row) => matches(row, args.where)),
    update: async (args: { where: Row; data: Row }) => {
      const row = (state.tables[name] ?? []).find((candidate) => matches(candidate, args.where));
      if (!row) throw new Error(`${name} not found`);
      Object.assign(row, args.data);
      return row;
    },
    updateMany: async (args: { where?: Row; data: Row }) => {
      const rows = (state.tables[name] ?? []).filter((row) => matches(row, args.where));
      rows.forEach((row) => Object.assign(row, args.data));
      return { count: rows.length };
    },
    delete: async (args: { where: Row }) => {
      const rows = state.tables[name] ?? [];
      const index = rows.findIndex((row) => matches(row, args.where));
      if (index < 0) throw new Error(`${name} not found`);
      return rows.splice(index, 1)[0];
    },
    create: async (args: { data: Row }) => {
      if (name === "auditEvent" && state.auditFail) throw new Error("synthetic audit failure");
      const row = { id: (state.tables[name]?.length ?? 0) + 1, ...args.data };
      (state.tables[name] ??= []).push(row);
      return row;
    },
    createMany: async (args: { data: Row[] }) => {
      for (const data of args.data) {
        const row = { id: (state.tables[name]?.length ?? 0) + 1, ...data };
        (state.tables[name] ??= []).push(row);
      }
      return { count: args.data.length };
    },
  });

  const prisma = new Proxy({}, {
    get(_target, property: string) {
      if (property === "$transaction") {
        return async (callback: (tx: unknown) => Promise<unknown>) => {
          const snapshot = structuredClone(state.tables);
          try {
            return await callback(prisma);
          } catch (error) {
            state.tables = snapshot;
            throw error;
          }
        };
      }
      return delegate(property);
    },
  });
  return { prisma };
});

import { DELETE as deleteBid } from "../../route";
import { DELETE as deleteMeeting, PATCH as patchMeeting } from "../[meetingId]/route";
import { POST as analyzeMeeting } from "../[meetingId]/analyze/route";
import { POST as mapSources } from "../[meetingId]/source-mapping/route";
import { PATCH as patchSpeakerMapping } from "../[meetingId]/speaker-mapping/route";
import { GET as pollTranscription } from "../[meetingId]/status/route";
import { POST as uploadMeeting } from "../[meetingId]/upload/route";
import { POST as uploadHybridMeeting } from "../[meetingId]/upload-hybrid/route";

const bidParams = { params: Promise.resolve({ id: "1" }) } as never;
const meetingParams = { params: Promise.resolve({ id: "1", meetingId: "2" }) } as never;
const request = (body: unknown) =>
  new Request("http://local.test", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function resetFixture() {
  state.auditFail = false;
  state.emitted = [];
  state.tables = {
    bid: [{ id: 1, createdById: "operator-1" }],
    meeting: [{
      id: 2,
      bidId: 1,
      status: "PENDING",
      transcript: null,
      speakerMapping: "{}",
      analysisVersion: 0,
      analyzedAt: null,
      reviewStatus: "DRAFT",
      transcriptionJobId: null,
      transcriptionSource: null,
      processingMode: "STANDARD",
      vttContent: null,
      rawTranscript: null,
      title: "Synthetic meeting",
      meetingType: "OAC",
      bid: { projectName: "Synthetic project" },
      participants: [],
    }],
    meetingParticipant: [{ id: 3, meetingId: 2, name: "SPEAKER_0", speakerLabel: "SPEAKER_0" }],
    meetingTranscriptSegment: [],
    meetingTranscriptCorrection: [],
    meetingRegisterEntry: [],
    meetingRegisterEntryRevision: [],
    meetingExtractionRun: [],
    meetingMinutesRevision: [],
    auditEvent: [],
  };
  external.blobData.clear();
  external.getSetting.mockClear();
  external.blobPut.mockClear();
  external.blobDelete.mockClear();
  external.readMeetingStorageBuffer.mockClear();
  external.recordAnalysisRun.mockClear();
}

beforeEach(resetFixture);
afterEach(() => vi.unstubAllGlobals());

describe("durable-history delete gates", () => {
  it("returns 409 and preserves byte-identical state for Meeting delete", async () => {
    state.tables.meetingTranscriptCorrection.push({ id: 8, meetingId: 2, bidId: 1 });
    const before = JSON.stringify(state.tables);
    const response = await deleteMeeting(new Request("http://local.test"), meetingParams);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("permanent") });
    expect(JSON.stringify(state.tables)).toBe(before);
  });

  it("returns 409 and preserves byte-identical state for Bid delete", async () => {
    state.tables.meetingMinutesRevision.push({ id: 9, meetingId: 2, bidId: 1 });
    const before = JSON.stringify(state.tables);
    const response = await deleteBid(new Request("http://local.test"), bidParams);
    expect(response.status).toBe(409);
    expect(JSON.stringify(state.tables)).toBe(before);
  });

  it("still deletes a meeting that has no durable history", async () => {
    const response = await deleteMeeting(new Request("http://local.test"), meetingParams);
    expect(response.status).toBe(200);
    expect(state.tables.meeting).toEqual([]);
  });
});

describe("legacy transcript and speaker gates", () => {
  it("rejects whole-transcript PATCH after materialization without any mutation", async () => {
    state.tables.meetingTranscriptSegment.push({ id: 7, meetingId: 2, bidId: 1 });
    const before = JSON.stringify(state.tables);
    const response = await patchMeeting(request({ transcript: "replacement" }), meetingParams);
    expect(response.status).toBe(409);
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it("commits pre-analysis transcript initialization and AuditEvent atomically", async () => {
    const response = await patchMeeting(
      request({ transcript: "[00:01] SPEAKER_0: Synthetic.", status: "READY" }),
      meetingParams,
    );
    expect(response.status).toBe(200);
    expect(state.tables.meeting[0]).toMatchObject({ transcript: expect.stringContaining("Synthetic"), status: "READY" });
    expect(state.tables.auditEvent).toHaveLength(1);
    expect(state.emitted).toHaveLength(1);
  });

  it("rolls transcript initialization back when mandatory audit fails", async () => {
    state.auditFail = true;
    const before = JSON.stringify(state.tables);
    await expect(
      patchMeeting(request({ transcript: "synthetic", status: "READY" }), meetingParams),
    ).rejects.toThrow("synthetic audit failure");
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it("rejects legacy speaker mapping after materialization without a partial loop", async () => {
    state.tables.meeting[0].transcript = "[00:01] SPEAKER_0: Synthetic.";
    state.tables.meetingTranscriptSegment.push({ id: 7, meetingId: 2, bidId: 1 });
    const before = JSON.stringify(state.tables);
    const response = await patchSpeakerMapping(
      request({ mapping: { SPEAKER_0: "Synthetic Person" } }),
      meetingParams,
    );
    expect(response.status).toBe(409);
    expect(JSON.stringify(state.tables)).toBe(before);
  });

  it("rolls the entire pre-materialization speaker loop back on audit failure", async () => {
    state.tables.meeting[0].transcript = "[00:01] SPEAKER_0: Synthetic.";
    state.auditFail = true;
    const before = JSON.stringify(state.tables);
    await expect(
      patchSpeakerMapping(request({ mapping: { SPEAKER_0: "Synthetic Person" } }), meetingParams),
    ).rejects.toThrow("synthetic audit failure");
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });
});

describe("central frozen-transcript boundary", () => {
  const freezeTriggers = [
    "meetingTranscriptSegment",
    "meetingTranscriptCorrection",
    "meetingRegisterEntry",
    "meetingExtractionRun",
    "meetingMinutesRevision",
  ] as const;

  it.each(freezeTriggers)(
    "rejects PATCH status/job re-arm for %s history with byte-identical state",
    async (table) => {
      state.tables[table].push({ id: 90, meetingId: 2, bidId: 1 });
      const before = JSON.stringify(state.tables);
      const response = await patchMeeting(
        request({ status: "TRANSCRIBING", transcriptionJobId: "attacker-job" }),
        meetingParams,
      );

      expect(response.status).toBe(409);
      expect(JSON.stringify(state.tables)).toBe(before);
      expect(state.emitted).toEqual([]);
    },
  );

  it("rejects standard upload before multipart parsing or provider work", async () => {
    state.tables.meetingTranscriptSegment.push({ id: 90, meetingId: 2, bidId: 1 });
    const formData = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = JSON.stringify(state.tables);

    const response = await uploadMeeting({ formData } as unknown as Request, meetingParams);

    expect(response.status).toBe(409);
    expect(formData).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it("rejects hybrid upload before multipart parsing or BlobStore work", async () => {
    state.tables.meetingTranscriptCorrection.push({ id: 91, meetingId: 2, bidId: 1 });
    const formData = vi.fn();
    const before = JSON.stringify(state.tables);

    const response = await uploadHybridMeeting(
      { formData } as unknown as Request,
      meetingParams,
    );

    expect(response.status).toBe(409);
    expect(formData).not.toHaveBeenCalled();
    expect(external.blobPut).not.toHaveBeenCalled();
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it("rejects hybrid source mapping before body, blob, or provider work", async () => {
    state.tables.meeting[0].status = "AWAITING_SOURCE_MAP";
    state.tables.meetingRegisterEntry.push({ id: 92, meetingId: 2, bidId: 1 });
    const json = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = JSON.stringify(state.tables);

    const response = await mapSources({ json } as unknown as Request, meetingParams);

    expect(response.status).toBe(409);
    expect(json).not.toHaveBeenCalled();
    expect(external.readMeetingStorageBuffer).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it.each([
    ["standard completion", "job-standard", null],
    ["hybrid no-VTT fallback", "HYBRID:job-no-vtt", null],
    ["hybrid merge fallback", "HYBRID:job-merge-fallback", "WEBVTT"],
    ["hybrid merged completion", "HYBRID:job-merged", "WEBVTT"],
  ])("rejects %s before polling or persistence", async (_path, jobId, vttContent) => {
    Object.assign(state.tables.meeting[0], {
      status: "TRANSCRIBING",
      transcriptionJobId: jobId,
      vttContent,
    });
    state.tables.meetingExtractionRun.push({ id: 93, meetingId: 2, bidId: 1 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = JSON.stringify(state.tables);

    const response = await pollTranscription(new Request("http://local.test"), meetingParams);

    expect(response.status).toBe(409);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it.each([
    {
      name: "standard completion",
      jobId: "job-standard",
      vttContent: null,
      responses: [{
        status: 200,
        body: {
          status: "completed",
          transcript: "standard transcript",
          rawTranscript: "{\"segments\":[]}",
          durationSeconds: 10,
          participants: [{ speakerLabel: "SPEAKER_1", name: "Person", wordCount: 2 }],
        },
      }],
      expectedTranscript: "standard transcript",
    },
    {
      name: "hybrid no-VTT fallback",
      jobId: "HYBRID:job-no-vtt",
      vttContent: null,
      responses: [{
        status: 200,
        body: {
          status: "completed",
          transcript: "no-vtt transcript",
          rawTranscript: "{\"segments\":[]}",
          participants: [],
        },
      }],
      expectedTranscript: "no-vtt transcript",
    },
    {
      name: "hybrid merge failure fallback",
      jobId: "HYBRID:job-merge-fallback",
      vttContent: "WEBVTT",
      responses: [
        {
          status: 200,
          body: {
            status: "completed",
            transcript: "merge fallback transcript",
            rawTranscript: "{\"segments\":[]}",
            participants: [],
          },
        },
        { status: 502, body: { detail: "synthetic merge failure" } },
      ],
      expectedTranscript: "merge fallback transcript",
    },
    {
      name: "hybrid merged completion",
      jobId: "HYBRID:job-merged",
      vttContent: "WEBVTT",
      responses: [
        {
          status: 200,
          body: {
            status: "completed",
            transcript: "plain transcript",
            rawTranscript: "{\"segments\":[]}",
            participants: [],
          },
        },
        {
          status: 200,
          body: {
            ok: true,
            transcript: "merged transcript",
            participants: [],
            clusters: [],
            durationSeconds: 12,
          },
        },
      ],
      expectedTranscript: "merged transcript",
    },
  ])("commits and audits the guarded $name path", async (testCase) => {
    Object.assign(state.tables.meeting[0], {
      status: "TRANSCRIBING",
      transcriptionJobId: testCase.jobId,
      vttContent: testCase.vttContent,
    });
    const responses = [...testCase.responses];
    const fetchMock = vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("unexpected provider call");
      return new Response(JSON.stringify(response.body), { status: response.status });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await pollTranscription(new Request("http://local.test"), meetingParams);

    expect(response.status).toBe(200);
    expect(state.tables.meeting[0]).toMatchObject({
      status: "READY",
      transcript: testCase.expectedTranscript,
    });
    expect(state.tables.auditEvent.filter(
      (row) => row.action === "meeting.transcription_completed",
    )).toHaveLength(1);
    expect(state.emitted).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(testCase.responses.length);
  });

  it("rechecks the freeze transactionally before provider completion persistence", async () => {
    Object.assign(state.tables.meeting[0], {
      status: "TRANSCRIBING",
      transcriptionJobId: "job-race",
    });
    const meetingBefore = JSON.stringify(state.tables.meeting);
    const participantsBefore = JSON.stringify(state.tables.meetingParticipant);
    vi.stubGlobal("fetch", vi.fn(async () => {
      // Synthetic concurrent materialization after the route preflight but
      // before provider output can be persisted.
      state.tables.meetingTranscriptSegment.push({ id: 96, meetingId: 2, bidId: 1 });
      return new Response(JSON.stringify({
        status: "completed",
        transcript: "must not persist",
        rawTranscript: "{\"segments\":[]}",
        participants: [{ speakerLabel: "SPEAKER_9", name: "Must Not Persist", wordCount: 1 }],
      }), { status: 200 });
    }));

    const response = await pollTranscription(new Request("http://local.test"), meetingParams);

    expect(response.status).toBe(409);
    expect(JSON.stringify(state.tables.meeting)).toBe(meetingBefore);
    expect(JSON.stringify(state.tables.meetingParticipant)).toBe(participantsBefore);
    expect(state.tables.meetingTranscriptSegment).toHaveLength(1);
    expect(state.tables.auditEvent).toEqual([]);
    expect(state.emitted).toEqual([]);
  });

  it("rejects an analysis transcript override before settings or provider work", async () => {
    state.tables.meeting[0].transcript = "[00:01] Corrected overlay";
    state.tables.meetingMinutesRevision.push({ id: 94, meetingId: 2, bidId: 1 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = JSON.stringify(state.tables);

    const response = await analyzeMeeting(
      new Request("http://local.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: "unaudited alternate wording" }),
      }),
      meetingParams,
    );

    expect(response.status).toBe(409);
    expect(external.getSetting).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(external.recordAnalysisRun).not.toHaveBeenCalled();
    expect(JSON.stringify(state.tables)).toBe(before);
  });

  it("uses the stored corrected overlay for post-materialization analysis", async () => {
    const overlay = "[00:01] Corrected overlay";
    state.tables.meeting[0].transcript = overlay;
    state.tables.meetingTranscriptSegment.push({ id: 95, meetingId: 2, bidId: 1 });
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({
          ok: true,
          analysis: {},
          tokensUsed: { input: 1, output: 1 },
        }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await analyzeMeeting(
      new Request("http://local.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full" }),
      }),
      meetingParams,
    );

    expect(response.status).toBe(200);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(init.body)).transcript).toBe(overlay);
    expect(external.recordAnalysisRun).toHaveBeenCalledTimes(1);
  });
});

describe("transcript-source audit rollback", () => {
  it("rolls back PATCH status/job arming when audit persistence fails", async () => {
    state.auditFail = true;
    const before = JSON.stringify(state.tables);
    await expect(
      patchMeeting(
        request({ status: "TRANSCRIBING", transcriptionJobId: "synthetic-job" }),
        meetingParams,
      ),
    ).rejects.toThrow("synthetic audit failure");
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it("rolls back standard upload arming before provider work on audit failure", async () => {
    state.auditFail = true;
    const form = new FormData();
    form.append("audio", new File(["audio"], "synthetic.wav", { type: "audio/wav" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const before = JSON.stringify(state.tables);

    await expect(
      uploadMeeting(new Request("http://local.test", { method: "POST", body: form }), meetingParams),
    ).rejects.toThrow("synthetic audit failure");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it("compensates hybrid audio and rolls database state back on audit failure", async () => {
    state.auditFail = true;
    const form = new FormData();
    form.append("vtt", new File(["WEBVTT\n\n<v Synthetic>hello"], "synthetic.vtt"));
    form.append("audio", new File(["audio"], "synthetic.wav", { type: "audio/wav" }));
    const before = JSON.stringify(state.tables);

    await expect(
      uploadHybridMeeting(
        new Request("http://local.test", { method: "POST", body: form }),
        meetingParams,
      ),
    ).rejects.toThrow("synthetic audit failure");

    expect(external.blobPut).toHaveBeenCalledTimes(1);
    expect(external.blobData.size).toBe(0);
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });

  it("rolls transcript, raw transcript, participants, and status back on completion audit failure", async () => {
    Object.assign(state.tables.meeting[0], {
      status: "TRANSCRIBING",
      transcriptionJobId: "job-standard",
    });
    state.auditFail = true;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      status: "completed",
      transcript: "provider replacement",
      rawTranscript: "{\"segments\":[]}",
      durationSeconds: 10,
      participants: [{ speakerLabel: "SPEAKER_1", name: "Person", wordCount: 2 }],
    }), { status: 200 })));
    const before = JSON.stringify(state.tables);

    const response = await pollTranscription(new Request("http://local.test"), meetingParams);

    expect(response.status).toBe(502);
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.emitted).toEqual([]);
  });
});
