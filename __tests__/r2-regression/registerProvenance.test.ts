// R2 auth/durability regression pack — Area A: manual Meeting Register
// provenance (route level).
//
// lib/services/meetingRegister/__tests__/register.test.ts already proves
// validateSegmentProvenance's SERVICE-level behavior (cross-meeting/cross-bid
// rejection). This file is an INDEPENDENT proof at the ROUTE level — POST
// .../register through the actual route handler — because no existing test
// exercises POST .../register end-to-end (confirmed by inventory: only
// service-level and route-security-guard tests exist today). A regression in
// the route's JSON parsing, error-status mapping, or in how it forwards
// segmentId to the service would not be caught by the service-level test
// alone.
//
// Every rejection case additionally proves NO partial write: zero
// MeetingRegisterEntry, MeetingRegisterEntryRevision, or AuditEvent rows are
// created, regardless of which check failed.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./support/mockPrisma";
import { ACTOR_A, BID_A, BID_B } from "./support/fixtures";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => ({ ok: true, user: { id: "user-a", role: "estimator" } })),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: ACTOR_A })),
}));
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import { POST as registerPOST } from "@/app/api/bids/[id]/meetings/[meetingId]/register/route";

const MEETING_A1 = 5; // meeting 5, bid A
const MEETING_A2 = 6; // meeting 6, ALSO bid A (cross-meeting-same-bid case)
const MEETING_B1 = 7; // meeting 7, bid B (cross-bid case)

const params = (id: string, meetingId: string) => ({ params: Promise.resolve({ id, meetingId }) });

const jsonReq = (body: unknown) =>
  new Request("http://local/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function noPartialWritesLeft(entryCountBefore: number, revisionCountBefore: number, auditCountBefore: number) {
  expect(state.prisma.meetingRegisterEntry.rows.length).toBe(entryCountBefore);
  expect(state.prisma.meetingRegisterEntryRevision.rows.length).toBe(revisionCountBefore);
  expect(state.prisma.auditEvent.rows.length).toBe(auditCountBefore);
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.meeting.create({ data: { id: MEETING_A1, bidId: BID_A } });
  await state.prisma.meeting.create({ data: { id: MEETING_A2, bidId: BID_A } });
  await state.prisma.meeting.create({ data: { id: MEETING_B1, bidId: BID_B } });
  // A real transcript segment that belongs to meeting A1/bid A — the ONLY
  // segmentId that should ever be accepted for a manual entry on meeting A1.
  await state.prisma.meetingTranscriptSegment.create({
    data: { id: 100, meetingId: MEETING_A1, bidId: BID_A, currentText: "hello", sortKey: 1, segmentIndex: 0 },
  });
  // A segment belonging to a DIFFERENT meeting in the SAME bid.
  await state.prisma.meetingTranscriptSegment.create({
    data: { id: 200, meetingId: MEETING_A2, bidId: BID_A, currentText: "other meeting", sortKey: 1, segmentIndex: 0 },
  });
  // A segment belonging to a DIFFERENT bid entirely.
  await state.prisma.meetingTranscriptSegment.create({
    data: { id: 300, meetingId: MEETING_B1, bidId: BID_B, currentText: "other bid", sortKey: 1, segmentIndex: 0 },
  });
});

describe("manual register entry — segmentId provenance (route level)", () => {
  it("accepts a segmentId that genuinely belongs to this meeting and bid", async () => {
    const res = await registerPOST(
      jsonReq({ entryType: "RISK", normalizedText: "Crane pad cure time", segmentId: 100 }),
      params(String(BID_A), String(MEETING_A1))
    );
    expect(res.status).toBe(201);
    expect(state.prisma.meetingRegisterEntry.rows).toHaveLength(1);
    expect(state.prisma.meetingRegisterEntry.rows[0].segmentId).toBe(100);
  });

  it("rejects a segmentId belonging to another meeting in the SAME bid — zero writes", async () => {
    const before = [
      state.prisma.meetingRegisterEntry.rows.length,
      state.prisma.meetingRegisterEntryRevision.rows.length,
      state.prisma.auditEvent.rows.length,
    ] as const;
    const res = await registerPOST(
      jsonReq({ entryType: "RISK", normalizedText: "Cross-meeting probe", segmentId: 200 }),
      params(String(BID_A), String(MEETING_A1))
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Segment not found");
    noPartialWritesLeft(...before);
  });

  it("rejects a segmentId belonging to another BID entirely — zero writes", async () => {
    const before = [
      state.prisma.meetingRegisterEntry.rows.length,
      state.prisma.meetingRegisterEntryRevision.rows.length,
      state.prisma.auditEvent.rows.length,
    ] as const;
    const res = await registerPOST(
      jsonReq({ entryType: "RISK", normalizedText: "Cross-bid probe", segmentId: 300 }),
      params(String(BID_A), String(MEETING_A1))
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Segment not found");
    noPartialWritesLeft(...before);
  });

  it("rejects a nonexistent segmentId — zero writes", async () => {
    const before = [
      state.prisma.meetingRegisterEntry.rows.length,
      state.prisma.meetingRegisterEntryRevision.rows.length,
      state.prisma.auditEvent.rows.length,
    ] as const;
    const res = await registerPOST(
      jsonReq({ entryType: "RISK", normalizedText: "Nonexistent probe", segmentId: 999999 }),
      params(String(BID_A), String(MEETING_A1))
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Segment not found");
    noPartialWritesLeft(...before);
  });

  it("nonexistent, cross-meeting, and cross-bid segmentId all produce the IDENTICAL error — a probe learns nothing", async () => {
    const responses = await Promise.all(
      [200, 300, 999999].map((segmentId) =>
        registerPOST(
          jsonReq({ entryType: "RISK", normalizedText: `probe ${segmentId}`, segmentId }),
          params(String(BID_A), String(MEETING_A1))
        ).then((r) => r.json())
      )
    );
    const errors = new Set(responses.map((r) => r.error));
    expect(errors.size).toBe(1);
    expect([...errors][0]).toBe("Segment not found");
  });

  it("rejects a non-integer / zero / negative segmentId — zero writes (a segment reference that cannot be proven to belong to the meeting)", async () => {
    for (const bad of [0, -1, 1.5]) {
      const before = [
        state.prisma.meetingRegisterEntry.rows.length,
        state.prisma.meetingRegisterEntryRevision.rows.length,
        state.prisma.auditEvent.rows.length,
      ] as const;
      const res = await registerPOST(
        jsonReq({ entryType: "RISK", normalizedText: `probe ${bad}`, segmentId: bad }),
        params(String(BID_A), String(MEETING_A1))
      );
      expect(res.status, `segmentId=${bad}`).toBe(400);
      noPartialWritesLeft(...before);
    }
  });
});
