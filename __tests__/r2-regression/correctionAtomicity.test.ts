// R2 auth/durability regression pack — Area B: transcript-correction
// atomicity + idempotency.
//
// lib/services/meetingRegister/__tests__/corrections.test.ts already proves
// service-level atomicity extensively. This file is an INDEPENDENT gate
// (fresh fixtures/mocks, not a copy) plus THREE angles that file does not
// cover:
//   1. route-level cross-bid/cross-meeting rejection with zero mutation,
//   2. an overlay-mutation-fails-first ordering case (mutate() itself throws,
//      proving no history/audit row is left behind),
//   3. the idempotency-count proof requested by the mission: repeated
//      identical correction requests are NOT deduplicated (append-only, by
//      design) — this test pins that documented contract so a future
//      accidental dedup (or accidental infinite growth beyond the documented
//      contract) shows up as a regression.

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

import { POST as correctionsPOST, PATCH, PUT, DELETE } from "@/app/api/bids/[id]/meetings/[meetingId]/segments/corrections/route";
import { applyCorrection } from "@/lib/services/meetingRegister/corrections";

const MEETING_A = 5;
const MEETING_B = 6; // different bid entirely

const params = (id: string, meetingId: string) => ({ params: Promise.resolve({ id, meetingId }) });
const jsonReq = (body: unknown) =>
  new Request("http://local/corrections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function seedMeetingWithSegment() {
  await state.prisma.meeting.create({ data: { id: MEETING_A, bidId: BID_A } });
  await state.prisma.meeting.create({ data: { id: MEETING_B, bidId: BID_B } });
  await state.prisma.meetingTranscriptSegment.create({
    data: {
      id: 10,
      meetingId: MEETING_A,
      bidId: BID_A,
      currentText: "original wording",
      currentSpeakerLabel: "Speaker A",
      sortKey: 1,
      segmentIndex: 0,
    },
  });
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  await seedMeetingWithSegment();
});

describe("route-level: cross-bid / cross-meeting correction requests perform NO mutation", () => {
  it("a correction posted against a meetingId that belongs to another bid path → 404, zero writes", async () => {
    // Meeting id 6 exists but under bid B; requesting it via bid A's URL
    // segment must not resolve to any meeting (findMeeting is bid-scoped).
    const res = await correctionsPOST(
      jsonReq({ correctionType: "EDIT_TEXT", segmentId: 10, newText: "hacked" }),
      params(String(BID_A), String(MEETING_B))
    );
    expect(res.status).toBe(404);
    expect(state.prisma.meetingTranscriptCorrection.rows).toHaveLength(0);
    expect(state.prisma.meetingTranscriptSegment.rows[0].currentText).toBe("original wording");
  });

  it("a segmentId belonging to another bid is rejected even though the meeting itself is valid — zero writes", async () => {
    await state.prisma.meetingTranscriptSegment.create({
      data: { id: 20, meetingId: MEETING_B, bidId: BID_B, currentText: "other bid text", sortKey: 1, segmentIndex: 0 },
    });
    const res = await correctionsPOST(
      jsonReq({ correctionType: "EDIT_TEXT", segmentId: 20, newText: "hacked" }),
      params(String(BID_A), String(MEETING_A))
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Segment not found");
    expect(state.prisma.meetingTranscriptCorrection.rows).toHaveLength(0);
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });

  it("an invalid correctionType is rejected before the service is ever called — zero writes", async () => {
    const res = await correctionsPOST(
      jsonReq({ correctionType: "NOT_A_REAL_TYPE", segmentId: 10 }),
      params(String(BID_A), String(MEETING_A))
    );
    expect(res.status).toBe(400);
    expect(state.prisma.meetingTranscriptCorrection.rows).toHaveLength(0);
  });

  it("PATCH/PUT/DELETE are hard-blocked to 405 — corrections are append-only at every layer", async () => {
    for (const handler of [PATCH, PUT, DELETE]) {
      const res = await handler();
      expect(res.status).toBe(405);
    }
  });
});

describe("atomicity — overlay-mutation-fails-first leaves no history/audit trace", () => {
  it("if the overlay mutation itself throws, no MeetingTranscriptCorrection or AuditEvent row is created", async () => {
    const originalUpdate = state.prisma.meetingTranscriptSegment.update;
    state.prisma.meetingTranscriptSegment.update = async () => {
      throw new Error("simulated overlay write failure");
    };
    await expect(
      applyCorrection(BID_A, MEETING_A, { correctionType: "EDIT_TEXT", segmentId: 10, newText: "new wording" }, ACTOR_A)
    ).rejects.toThrow("simulated overlay write failure");
    state.prisma.meetingTranscriptSegment.update = originalUpdate;

    expect(state.prisma.meetingTranscriptCorrection.rows).toHaveLength(0);
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
    expect(state.prisma.meetingTranscriptSegment.rows[0].currentText).toBe("original wording");
  });

  it("if the correction-history append fails, the overlay mutation rolls back (segment text unchanged)", async () => {
    const originalCreate = state.prisma.meetingTranscriptCorrection.create;
    state.prisma.meetingTranscriptCorrection.create = async () => {
      throw new Error("simulated history write failure");
    };
    await expect(
      applyCorrection(BID_A, MEETING_A, { correctionType: "EDIT_TEXT", segmentId: 10, newText: "new wording" }, ACTOR_A)
    ).rejects.toThrow("simulated history write failure");
    state.prisma.meetingTranscriptCorrection.create = originalCreate;

    expect(state.prisma.meetingTranscriptSegment.rows[0].currentText).toBe("original wording");
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });

  it("if the mandatory AuditEvent write fails, BOTH the overlay mutation and the history row roll back", async () => {
    const originalCreate = state.prisma.auditEvent.create;
    state.prisma.auditEvent.create = async () => {
      throw new Error("simulated audit-store failure");
    };
    await expect(
      applyCorrection(BID_A, MEETING_A, { correctionType: "EDIT_TEXT", segmentId: 10, newText: "new wording" }, ACTOR_A)
    ).rejects.toThrow("simulated audit-store failure");
    state.prisma.auditEvent.create = originalCreate;

    expect(state.prisma.meetingTranscriptSegment.rows[0].currentText).toBe("original wording");
    expect(state.prisma.meetingTranscriptCorrection.rows).toHaveLength(0);
  });
});

describe("idempotency — documented contract: append-only, NOT deduplicated on repeat", () => {
  it("two identical EDIT_TEXT requests produce TWO correction rows and TWO audit rows (state converges, history does not dedupe)", async () => {
    const first = await applyCorrection(
      BID_A, MEETING_A, { correctionType: "EDIT_TEXT", segmentId: 10, newText: "converged wording" }, ACTOR_A
    );
    expect(first.ok).toBe(true);
    const second = await applyCorrection(
      BID_A, MEETING_A, { correctionType: "EDIT_TEXT", segmentId: 10, newText: "converged wording" }, ACTOR_A
    );
    expect(second.ok).toBe(true);

    // State-level: idempotent — the segment converges to the same value.
    expect(state.prisma.meetingTranscriptSegment.rows[0].currentText).toBe("converged wording");

    // History-level: NOT idempotent — this is the documented append-only
    // contract (prisma/schema.prisma MeetingTranscriptCorrection header: "no
    // update or delete path exists at any layer... a wrong correction is
    // corrected by appending another correction"). If this count ever drops
    // to 1, either dedup was silently added (breaking the documented
    // contract) or the second request silently no-opped.
    expect(state.prisma.meetingTranscriptCorrection.rows).toHaveLength(2);
    expect(state.prisma.auditEvent.rows).toHaveLength(2);
    if (first.ok && second.ok) {
      expect(second.value.correctionId).not.toBe(first.value.correctionId);
    } else {
      throw new Error("expected both applyCorrection calls to succeed");
    }
  });
});
