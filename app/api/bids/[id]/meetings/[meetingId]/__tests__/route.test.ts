import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const historicalTranscript = "[00:01] SPEAKER_00: Historical transcript";
const meeting = {
  id: 9,
  bidId: 1,
  title: "Historical OAC",
  meetingDate: new Date("2026-01-15T12:00:00.000Z"),
  meetingType: "OAC",
  location: "Archive",
  status: "READY",
  audioFileName: "historical.wav",
  durationSeconds: 120,
  transcriptionSource: "ASSEMBLYAI",
  transcriptionJobId: "AAI:historical-job",
  transcript: historicalTranscript,
  summary: "Historical summary",
  keyDecisions: "[]",
  openIssues: "[]",
  redFlags: "[]",
  analysisVersion: 1,
  reviewStatus: "PUBLISHED",
  processingMode: "AUTO",
  speakerMapping: null,
  uploadedAt: new Date("2026-01-15T11:00:00.000Z"),
  analyzedAt: new Date("2026-01-15T13:00:00.000Z"),
  createdAt: new Date("2026-01-15T10:00:00.000Z"),
  updatedAt: new Date("2026-01-15T13:00:00.000Z"),
  participants: [],
  actionItems: [],
};

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({
    ok: true,
    user: { id: "u1", role: "admin" },
  })),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    meeting: {
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
  },
}));

vi.mock("@/lib/services/meetingRegister/retention", () => ({
  deleteMeetingWithoutHistory: vi.fn(),
  DURABLE_HISTORY_CONFLICT: "durable history",
  FROZEN_TRANSCRIPT_CONFLICT: "frozen transcript",
  withMutableMeetingTranscript: vi.fn(),
}));

vi.mock("@/lib/services/meetingRegister/txAudit", () => ({
  emitRegisterAuditPostCommit: vi.fn(),
  writeRegisterAuditTx: vi.fn(),
}));

vi.mock("@/lib/services/storage/referenceSafety", () => ({
  deleteMeetingStorageIfUnreferenced: vi.fn(),
}));

import { GET } from "../route";

const routeParams = {
  params: Promise.resolve({ id: "1", meetingId: "9" }),
};

describe("historical meeting detail reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.LEGACY_TRANSCRIPTION_ENABLED;
    process.env.LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED = "invalid";
    mocks.findFirst.mockResolvedValue(meeting);
  });

  afterEach(() => {
    delete process.env.LEGACY_TRANSCRIPTION_ENABLED;
    delete process.env.LEGACY_TRANSCRIPTION_EXTERNAL_ENABLED;
  });

  it("keeps stored transcripts readable without invoking or rewriting legacy processing", async () => {
    const response = await GET(
      new Request("http://local/api/bids/1/meetings/9"),
      routeParams,
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      id: 9,
      status: "READY",
      transcript: historicalTranscript,
      transcriptionJobId: "AAI:historical-job",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
