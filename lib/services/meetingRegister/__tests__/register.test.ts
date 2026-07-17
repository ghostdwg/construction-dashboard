// R2-B1 — register entries: manual create (lands CONFIRMED), normalized
// edit (rawSourceText frozen), disposition state machine (rule 11), and
// coverage / fully-reviewed gate.

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

import { createManualEntry, dispositionEntry, editEntry, getCoverage } from "../register";

const ACTOR = { name: "Josh", email: "josh@example.com" };

async function seedEntry(overrides: Record<string, unknown> = {}) {
  return state.prisma.meetingRegisterEntry.create({
    data: {
      meetingId: 5,
      bidId: 1,
      entryType: "ACTION_ITEM",
      rawSourceText: "original wording from transcript",
      normalizedText: "Submit shop drawings",
      origin: "ai_extraction",
      ...overrides,
    },
  });
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.meeting.create({ data: { id: 5, bidId: 1 } });
});

describe("createManualEntry", () => {
  it("creates a CONFIRMED entry with a CREATED revision row", async () => {
    const result = await createManualEntry(
      1, 5,
      { entryType: "CONSTRAINT", normalizedText: "Crane pad must cure 7 days" },
      ACTOR
    );
    expect(result.ok).toBe(true);
    const entry = state.prisma.meetingRegisterEntry.rows[0];
    expect(entry).toMatchObject({
      origin: "manual",
      reviewState: "CONFIRMED",
      rawSourceText: "Crane pad must cure 7 days",
      dispositionBy: "josh@example.com",
    });
    expect(state.prisma.meetingRegisterEntryRevision.rows[0]).toMatchObject({
      changeType: "CREATED",
      toReviewState: "CONFIRMED",
      actor: "josh@example.com",
    });
  });

  it("rejects invalid entry types and missing actor", async () => {
    const badType = await createManualEntry(1, 5, { entryType: "TODO", normalizedText: "x" }, ACTOR);
    expect(badType.ok).toBe(false);
    const noActor = await createManualEntry(
      1, 5,
      { entryType: "DISCUSSION", normalizedText: "x" },
      { name: null, email: null }
    );
    expect(noActor.ok).toBe(false);
  });

  it("supports all 11 entry types", async () => {
    for (const t of [
      "DISCUSSION", "DECISION", "QUESTION", "ACTION_ITEM", "COMMITMENT", "DESIGN_CHANGE",
      "RISK", "CONSTRAINT", "SCHEDULE_ITEM", "PROCUREMENT_ITEM", "INFORMATIONAL",
    ]) {
      const result = await createManualEntry(1, 5, { entryType: t, normalizedText: `entry ${t}` }, ACTOR);
      expect(result.ok, t).toBe(true);
    }
    expect(state.prisma.meetingRegisterEntry.rows).toHaveLength(11);
  });
});

describe("editEntry", () => {
  it("edits normalizedText but can never touch rawSourceText", async () => {
    await seedEntry();
    const result = await editEntry(1, 5, 1, { normalizedText: "Submit REVISED shop drawings" }, ACTOR);
    expect(result.ok).toBe(true);
    const entry = state.prisma.meetingRegisterEntry.rows[0];
    expect(entry.normalizedText).toBe("Submit REVISED shop drawings");
    expect(entry.rawSourceText).toBe("original wording from transcript"); // frozen
    expect(state.prisma.meetingRegisterEntryRevision.rows[0]).toMatchObject({ changeType: "EDIT" });
  });
});

describe("dispositionEntry", () => {
  it("CONFIRMED / DISCUSSION_ONLY / INFORMATIONAL are one-step dispositions", async () => {
    for (const [i, d] of ["CONFIRMED", "DISCUSSION_ONLY", "INFORMATIONAL"].entries()) {
      await seedEntry();
      const result = await dispositionEntry(1, 5, i + 1, { disposition: d }, ACTOR);
      expect(result.ok, d).toBe(true);
      expect(state.prisma.meetingRegisterEntry.rows[i].reviewState).toBe(d);
    }
  });

  it("DISMISSED_WITH_REASON requires a reason", async () => {
    await seedEntry();
    const noReason = await dispositionEntry(1, 5, 1, { disposition: "DISMISSED_WITH_REASON" }, ACTOR);
    expect(noReason.ok).toBe(false);
    const withReason = await dispositionEntry(
      1, 5, 1,
      { disposition: "DISMISSED_WITH_REASON", reason: "not actually discussed" },
      ACTOR
    );
    expect(withReason.ok).toBe(true);
    expect(state.prisma.meetingRegisterEntry.rows[0].dispositionReason).toBe("not actually discussed");
  });

  it("MERGED requires a same-project target and records mergedIntoEntryId", async () => {
    await seedEntry();
    await seedEntry({ normalizedText: "duplicate wording" });
    const noTarget = await dispositionEntry(1, 5, 2, { disposition: "MERGED" }, ACTOR);
    expect(noTarget.ok).toBe(false);
    const selfTarget = await dispositionEntry(1, 5, 2, { disposition: "MERGED", targetEntryId: 2 }, ACTOR);
    expect(selfTarget.ok).toBe(false);
    const merged = await dispositionEntry(1, 5, 2, { disposition: "MERGED", targetEntryId: 1 }, ACTOR);
    expect(merged.ok).toBe(true);
    expect(state.prisma.meetingRegisterEntry.rows[1].mergedIntoEntryId).toBe(1);
  });

  it("CORRECTED requires corrected wording and applies it", async () => {
    await seedEntry();
    const bad = await dispositionEntry(1, 5, 1, { disposition: "CORRECTED" }, ACTOR);
    expect(bad.ok).toBe(false);
    const good = await dispositionEntry(
      1, 5, 1,
      { disposition: "CORRECTED", correctedText: "Submit steel shop drawings rev 2" },
      ACTOR
    );
    expect(good.ok).toBe(true);
    expect(state.prisma.meetingRegisterEntry.rows[0].normalizedText).toBe(
      "Submit steel shop drawings rev 2"
    );
  });

  it("rejects PROMOTED_TO_OPERATIONS here and re-disposition of promoted entries", async () => {
    await seedEntry();
    const promoted = await dispositionEntry(1, 5, 1, { disposition: "PROMOTED_TO_OPERATIONS" }, ACTOR);
    expect(promoted.ok).toBe(false);
    await state.prisma.meetingRegisterEntry.update({
      where: { id: 1 },
      data: { reviewState: "PROMOTED_TO_OPERATIONS" },
    });
    const redispose = await dispositionEntry(1, 5, 1, { disposition: "CONFIRMED" }, ACTOR);
    expect(redispose.ok).toBe(false);
  });

  it("every disposition appends a DISPOSITION revision row (append-only history)", async () => {
    await seedEntry();
    await dispositionEntry(1, 5, 1, { disposition: "CONFIRMED" }, ACTOR);
    expect(state.prisma.meetingRegisterEntryRevision.rows).toHaveLength(1);
    expect(state.prisma.meetingRegisterEntryRevision.rows[0]).toMatchObject({
      changeType: "DISPOSITION",
      fromReviewState: "PENDING",
      toReviewState: "CONFIRMED",
    });
  });

  it("404s cross-bid entry ids", async () => {
    await seedEntry({ bidId: 2 });
    const result = await dispositionEntry(1, 5, 1, { disposition: "CONFIRMED" }, ACTOR);
    expect(result).toMatchObject({ ok: false, error: "Not found" });
  });
});

describe("getCoverage — fully-reviewed gate (rule 11)", () => {
  it("counts only machine-origin entries toward the pending gate", async () => {
    await seedEntry(); // extracted PENDING
    await seedEntry({ origin: "commitment_bridge" }); // extracted PENDING
    await seedEntry({ origin: "manual", reviewState: "CONFIRMED" });
    let coverage = await getCoverage(1, 5);
    expect(coverage).toMatchObject({
      total: 3,
      extracted: 2,
      pendingExtracted: 2,
      fullyReviewed: false,
    });

    await dispositionEntry(1, 5, 1, { disposition: "CONFIRMED" }, ACTOR);
    await dispositionEntry(1, 5, 2, { disposition: "DUPLICATE", targetEntryId: 1 }, ACTOR);
    coverage = await getCoverage(1, 5);
    expect(coverage.fullyReviewed).toBe(true);
    expect(coverage.pendingExtracted).toBe(0);
  });
});

describe("segment provenance (release blocker 3)", () => {
  beforeEach(async () => {
    // meeting 6 = same bid, different meeting; meeting 7 = DIFFERENT bid.
    await state.prisma.meeting.create({ data: { id: 6, bidId: 1 } });
    await state.prisma.meeting.create({ data: { id: 7, bidId: 2 } });
    await state.prisma.meetingTranscriptSegment.create({
      data: { id: 11, meetingId: 5, bidId: 1, segmentIndex: 0, sortKey: 0, originalText: "own segment", currentText: "own segment" },
    });
    await state.prisma.meetingTranscriptSegment.create({
      data: { id: 12, meetingId: 6, bidId: 1, segmentIndex: 0, sortKey: 0, originalText: "other meeting", currentText: "other meeting" },
    });
    await state.prisma.meetingTranscriptSegment.create({
      data: { id: 13, meetingId: 7, bidId: 2, segmentIndex: 0, sortKey: 0, originalText: "other bid", currentText: "other bid" },
    });
  });

  it("accepts a segment that belongs to this meeting and bid", async () => {
    const result = await createManualEntry(
      1, 5,
      { entryType: "DECISION", normalizedText: "cited decision", segmentId: 11 },
      ACTOR
    );
    expect(result.ok).toBe(true);
    expect(state.prisma.meetingRegisterEntry.rows[0].segmentId).toBe(11);
  });

  it("rejects a same-bid segment from a DIFFERENT meeting", async () => {
    const result = await createManualEntry(
      1, 5,
      { entryType: "DECISION", normalizedText: "bad citation", segmentId: 12 },
      ACTOR
    );
    expect(result).toMatchObject({ ok: false, error: "Segment not found" });
    expect(state.prisma.meetingRegisterEntry.rows).toHaveLength(0);
  });

  it("rejects a cross-bid segment with the SAME error as a nonexistent one (no probe signal)", async () => {
    const crossBid = await createManualEntry(
      1, 5,
      { entryType: "DECISION", normalizedText: "cross-bid citation", segmentId: 13 },
      ACTOR
    );
    const nonexistent = await createManualEntry(
      1, 5,
      { entryType: "DECISION", normalizedText: "ghost citation", segmentId: 9999 },
      ACTOR
    );
    expect(crossBid).toMatchObject({ ok: false, error: "Segment not found" });
    expect(nonexistent).toMatchObject({ ok: false, error: "Segment not found" });
    expect(state.prisma.meetingRegisterEntry.rows).toHaveLength(0);
  });
});

describe("audit policy — fail-closed, in-transaction (release blocker 5)", () => {
  it("commits the AuditEvent row atomically with a disposition", async () => {
    await seedEntry();
    await dispositionEntry(1, 5, 1, { disposition: "CONFIRMED" }, ACTOR);
    const audits = state.prisma.auditEvent.rows.filter(
      (a) => a.action === "register_entry_dispositioned"
    );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      category: "register_action",
      subjectKind: "MeetingRegisterEntry",
      subjectId: "1",
      actorEmail: "josh@example.com",
    });
    const payload = JSON.parse(audits[0].payloadJson as string);
    expect(payload).toMatchObject({ bidId: 1, meetingId: 5, registerEntryId: 1, from: "PENDING", to: "CONFIRMED" });
    expect(payload.revisionId).toBeGreaterThan(0);
  });

  it("rolls the disposition back entirely when the audit write fails (never fail-open)", async () => {
    await seedEntry();
    state.prisma.auditEvent.create = async () => {
      throw new Error("audit store down");
    };
    await expect(
      dispositionEntry(1, 5, 1, { disposition: "CONFIRMED" }, ACTOR)
    ).rejects.toThrow("audit store down");
    // Entry untouched, no revision row, no audit row.
    expect(state.prisma.meetingRegisterEntry.rows[0].reviewState).toBe("PENDING");
    expect(state.prisma.meetingRegisterEntryRevision.rows).toHaveLength(0);
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });
});

describe("SUPERSEDED entries are immutable history", () => {
  it("cannot be dispositioned or edited", async () => {
    await seedEntry({ reviewState: "SUPERSEDED", supersededByRunId: 2 });
    const dispo = await dispositionEntry(1, 5, 1, { disposition: "CONFIRMED" }, ACTOR);
    expect(dispo.ok).toBe(false);
    const edit = await editEntry(1, 5, 1, { normalizedText: "rewrite history" }, ACTOR);
    expect(edit.ok).toBe(false);
    expect(state.prisma.meetingRegisterEntry.rows[0].normalizedText).toBe("Submit shop drawings");
  });

  it("is excluded from coverage totals and the fully-reviewed gate", async () => {
    await seedEntry({ reviewState: "SUPERSEDED", supersededByRunId: 2 });
    await seedEntry({ origin: "manual", reviewState: "CONFIRMED" });
    const coverage = await getCoverage(1, 5);
    expect(coverage).toMatchObject({
      total: 1,
      superseded: 1,
      pendingExtracted: 0,
      fullyReviewed: true,
    });
  });
});
