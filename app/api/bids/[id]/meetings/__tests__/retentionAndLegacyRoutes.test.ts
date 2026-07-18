import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  auditFail: false,
  emitted: [] as unknown[],
  tables: {} as Record<string, Row[]>,
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
import { PATCH as patchSpeakerMapping } from "../[meetingId]/speaker-mapping/route";

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
}

beforeEach(resetFixture);

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
