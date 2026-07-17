// R2-B1 — minutes: publish gate (rule 11), immutable revisions,
// amendments require a reason and supersede set-once (rule 9).

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./mockDb";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
// Real audit module (fail-closed in-tx persistence) — stdout suppressed.
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import { listRevisions, publishMinutes } from "../minutes";

const ACTOR = { name: "Josh", email: "josh@example.com" };

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.meeting.create({
    data: {
      id: 5,
      bidId: 1,
      title: "OAC #12",
      meetingDate: new Date("2026-07-01T15:00:00Z"),
      summary: "Weekly OAC.",
      keyDecisions: '["Decision A"]',
      openIssues: "[]",
      redFlags: "[]",
      analysisVersion: 2,
      reviewStatus: "DRAFT",
    },
  });
});

describe("publishMinutes", () => {
  it("blocks publication while extracted entries are undispositioned", async () => {
    await state.prisma.meetingRegisterEntry.create({
      data: { meetingId: 5, bidId: 1, entryType: "RISK", rawSourceText: "r", normalizedText: "r", origin: "ai_extraction" },
    });
    const result = await publishMinutes(1, 5, {}, ACTOR);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/undispositioned/);
    expect(state.prisma.meetingMinutesRevision.rows).toHaveLength(0);
  });

  it("publishes revision 0 with a frozen snapshot and sets the meeting PUBLISHED", async () => {
    await state.prisma.meetingRegisterEntry.create({
      data: {
        meetingId: 5, bidId: 1, entryType: "DECISION", rawSourceText: "d", normalizedText: "Use terrazzo",
        origin: "ai_extraction", reviewState: "CONFIRMED",
      },
    });
    const result = await publishMinutes(1, 5, {}, ACTOR);
    expect(result.ok && result.value.revisionIndex).toBe(0);

    const rev = state.prisma.meetingMinutesRevision.rows[0];
    expect(rev.publishedBy).toBe("josh@example.com");
    const snap = JSON.parse(rev.contentJson as string);
    expect(snap.title).toBe("OAC #12");
    expect(snap.keyDecisions).toEqual(["Decision A"]);
    expect(snap.registerEntries).toHaveLength(1);
    expect(snap.registerEntries[0].normalizedText).toBe("Use terrazzo");

    expect(state.prisma.meeting.rows[0].reviewStatus).toBe("PUBLISHED");
  });

  it("amendment requires a reason, increments the index, and supersedes the prior revision", async () => {
    await publishMinutes(1, 5, {}, ACTOR);

    const noReason = await publishMinutes(1, 5, {}, ACTOR);
    expect(noReason.ok).toBe(false);

    const amended = await publishMinutes(1, 5, { amendmentReason: "speaker correction changed §4" }, ACTOR);
    expect(amended.ok && amended.value.revisionIndex).toBe(1);

    const [rev0, rev1] = state.prisma.meetingMinutesRevision.rows;
    expect(rev1.supersedesRevisionId).toBe(rev0.id);
    expect(rev1.amendmentReason).toBe("speaker correction changed §4");
    // prior publication remains untouched (immutable)
    expect(rev0.amendmentReason).toBeNull();
    expect(rev0.revisionIndex).toBe(0);
  });

  it("requires a session actor", async () => {
    const result = await publishMinutes(1, 5, {}, { name: null, email: null });
    expect(result.ok).toBe(false);
  });

  it("404s cross-bid", async () => {
    const result = await publishMinutes(9, 5, {}, ACTOR);
    expect(result).toMatchObject({ ok: false, error: "Not found" });
  });
});

describe("listRevisions", () => {
  it("lists newest-first with snapshots intact", async () => {
    await publishMinutes(1, 5, {}, ACTOR);
    await publishMinutes(1, 5, { amendmentReason: "amend" }, ACTOR);
    const revisions = await listRevisions(1, 5);
    expect(revisions.map((r) => r.revisionIndex)).toEqual([1, 0]);
  });
});
