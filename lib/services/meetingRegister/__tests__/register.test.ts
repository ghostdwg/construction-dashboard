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
const auditMock = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: auditMock }));

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
  auditMock.mockClear();
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
