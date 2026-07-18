// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/meetings/[meetingId]/source-mapping/__tests__/route.test.ts
//
//  Artifact-durability coverage: this route used to reconstruct the audio
//  read path purely from process.cwd()/uploads/meetings/{id}/{audioFileName}
//  — pure naming-convention reconstruction, no stored path/key at all. It now
//  resolves the new Meeting.audioStorageKey column (relative BlobStore key,
//  legacy cwd-rooted path, or production storage-root path — see
//  lib/services/meetings/storagePath.ts) when present, and falls back to the
//  pre-existing naming-convention reconstruction ONLY for historic rows where
//  audioStorageKey is null — that fallback must be byte-for-byte unchanged.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type MeetingRow = {
  id: number;
  bidId: number;
  status: string;
  speakerMapping: string | null;
  audioFileName: string | null;
  audioStorageKey: string | null;
  vttContent: string | null;
};

const db = {
  meeting: null as MeetingRow | null,
  updates: [] as Array<Partial<MeetingRow>>,
};

function resetDb() {
  db.meeting = null;
  db.updates = [];
}

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({ ok: true, user: { id: "u1", role: "admin" } })),
}));

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

// Artifact-path tests isolate storage compatibility. Frozen-boundary behavior
// is covered by the dedicated transcript-freeze route suite.
vi.mock("@/lib/services/meetingRegister/retention", () => ({
  FROZEN_TRANSCRIPT_CONFLICT: "frozen",
  meetingTranscriptMutationGate: vi.fn(async () => ({ ok: true })),
  withMutableMeetingTranscript: vi.fn(async (_bidId, _meetingId, mutate) => ({
    ok: true,
    value: await mutate({
      meeting: {
        update: async ({ data }: { data: Partial<MeetingRow> }) => {
          db.updates.push(data);
          if (db.meeting) Object.assign(db.meeting, data);
          return db.meeting;
        },
      },
    }),
  })),
}));

vi.mock("@/lib/services/meetingRegister/txAudit", () => ({
  writeRegisterAuditTx: vi.fn(async () => ({ action: "synthetic" })),
  emitRegisterAuditPostCommit: vi.fn(),
}));

// "fs/promises" — only ever exercised for the historic naming-convention
// fallback (audioStorageKey === null). A different module specifier than
// readMeetingStorageBuffer's own BlobStore access, so mocking it never masks
// whether the new-column path was actually used.
const fsReadFileMock = vi.fn(async (_path: string) => Buffer.from("legacy on-disk audio bytes"));
vi.mock("fs/promises", () => ({
  default: { readFile: fsReadFileMock },
  readFile: fsReadFileMock,
}));

const readMeetingStorageBufferMock = vi.fn(async () => Buffer.from("durable blobstore audio bytes"));
vi.mock("@/lib/services/meetings/storagePath", () => ({
  readMeetingStorageBuffer: readMeetingStorageBufferMock,
}));

const routeParams = { params: Promise.resolve({ id: "1", meetingId: "9" }) };

function makeRequest(body: unknown = { sources: {} }) {
  return new Request("http://localhost/api/bids/1/meetings/9/source-mapping", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/bids/[id]/meetings/[meetingId]/source-mapping", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ transcriptionJobId: "job-1", source: "HYBRID" }), { status: 200 }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("resolves the new column via readMeetingStorageBuffer when audioStorageKey is present — never falls back to fs.readFile", async () => {
    db.meeting = {
      id: 9,
      bidId: 1,
      status: "AWAITING_SOURCE_MAP",
      speakerMapping: null,
      audioFileName: "recording.wav",
      audioStorageKey: "uploads/meetings/9/recording.wav",
      vttContent: "WEBVTT",
    };

    const { POST } = await import("../route");
    const res = await POST(makeRequest(), routeParams);
    expect(res.status).toBe(200);

    expect(readMeetingStorageBufferMock).toHaveBeenCalledWith("uploads/meetings/9/recording.wav", 9);
    expect(fsReadFileMock).not.toHaveBeenCalled();
  });

  test("historic row with audioStorageKey === null falls back to the pre-existing naming-convention fs.readFile reconstruction", async () => {
    db.meeting = {
      id: 9,
      bidId: 1,
      status: "AWAITING_SOURCE_MAP",
      speakerMapping: null,
      audioFileName: "legacy-recording.wav",
      audioStorageKey: null,
      vttContent: "WEBVTT",
    };

    const { POST } = await import("../route");
    const res = await POST(makeRequest(), routeParams);
    expect(res.status).toBe(200);

    expect(fsReadFileMock).toHaveBeenCalledTimes(1);
    const [passedPath] = fsReadFileMock.mock.calls[0];
    expect(passedPath).toContain("uploads");
    expect(passedPath).toContain("meetings");
    expect(passedPath).toContain("9");
    expect(passedPath).toContain("legacy-recording.wav");
    expect(readMeetingStorageBufferMock).not.toHaveBeenCalled();
  });

  test("a failed read (BlobStore path) marks the meeting FAILED and returns 500 without calling the sidecar", async () => {
    readMeetingStorageBufferMock.mockRejectedValueOnce(new Error("not found"));
    db.meeting = {
      id: 9,
      bidId: 1,
      status: "AWAITING_SOURCE_MAP",
      speakerMapping: null,
      audioFileName: "recording.wav",
      audioStorageKey: "uploads/meetings/9/recording.wav",
      vttContent: "WEBVTT",
    };

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { POST } = await import("../route");
    const res = await POST(makeRequest(), routeParams);
    expect(res.status).toBe(500);
    expect(db.meeting!.status).toBe("FAILED");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("meeting not awaiting source mapping is rejected with 400", async () => {
    db.meeting = {
      id: 9,
      bidId: 1,
      status: "PENDING",
      speakerMapping: null,
      audioFileName: "recording.wav",
      audioStorageKey: "uploads/meetings/9/recording.wav",
      vttContent: "WEBVTT",
    };
    const { POST } = await import("../route");
    const res = await POST(makeRequest(), routeParams);
    expect(res.status).toBe(400);
  });
});
