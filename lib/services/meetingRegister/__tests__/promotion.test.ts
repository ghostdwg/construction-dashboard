// R2-B1 — Operations Register promotion & linking: full provenance on the
// TrackedItem, the register entry is never removed, duplicate promotion is
// guarded, links are same-bid only, and one item collects continuity from
// entries across meetings (rule 10).

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

import { linkEntryToItem, promoteEntry } from "../promotion";

const ACTOR = { name: "Josh", email: "josh@example.com" };

async function seedEntry(overrides: Record<string, unknown> = {}) {
  return state.prisma.meetingRegisterEntry.create({
    data: {
      meetingId: 5,
      bidId: 1,
      entryType: "COMMITMENT",
      rawSourceText: "we will have the mockup on site by end of month",
      normalizedText: "Deliver mockup panel by end of month",
      speakerLabel: "SPEAKER_2",
      speakerName: "Sarah Chen",
      responsibleParty: "Sarah Chen",
      sourceCitation: "[01:30] SPEAKER_2",
      segmentId: 7,
      dueDate: new Date("2026-07-31T00:00:00Z"),
      origin: "commitment_bridge",
      extractionRunId: 3,
      ...overrides,
    },
  });
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.meeting.create({ data: { id: 5, bidId: 1 } });
  await state.prisma.meeting.create({ data: { id: 6, bidId: 1 } });
});

describe("promoteEntry", () => {
  it("creates a TrackedItem carrying FULL source provenance and preserves the entry", async () => {
    await seedEntry();
    const result = await promoteEntry(1, 5, 1, {}, ACTOR);
    expect(result.ok).toBe(true);

    const item = state.prisma.trackedItem.rows[0];
    expect(item).toMatchObject({
      bidId: 1,
      kind: "OAC_ACTION",
      title: "Deliver mockup panel by end of month",
      sourceKind: "meeting_register",
      sourceMeetingId: 5,
      sourceMeetingRegisterEntryId: 1,
      evidenceExcerpt: "we will have the mockup on site by end of month",
      sourceLocator: "[01:30] SPEAKER_2",
      assigneeName: "Sarah Chen",
      extractionMethod: "meeting_analysis",
      extractorVersion: "register-run-3",
      citationVerified: true,
    });

    // Promotion must not remove the Meeting Register entry.
    const entry = state.prisma.meetingRegisterEntry.rows[0];
    expect(entry).toMatchObject({
      reviewState: "PROMOTED_TO_OPERATIONS",
      linkedTrackedItemId: item.id,
      rawSourceText: "we will have the mockup on site by end of month",
    });
    expect(state.prisma.meetingRegisterEntryRevision.rows[0]).toMatchObject({
      changeType: "PROMOTION",
      toReviewState: "PROMOTED_TO_OPERATIONS",
    });
  });

  it("manual-origin entries promote with extractionMethod manual", async () => {
    await seedEntry({ origin: "manual", extractionRunId: null, segmentId: null });
    await promoteEntry(1, 5, 1, {}, ACTOR);
    expect(state.prisma.trackedItem.rows[0]).toMatchObject({
      extractionMethod: "manual",
      extractorVersion: null,
      citationVerified: false,
    });
  });

  it("guards double promotion (unique originating entry)", async () => {
    await seedEntry();
    await promoteEntry(1, 5, 1, {}, ACTOR);
    const again = await promoteEntry(1, 5, 1, {}, ACTOR);
    expect(again.ok).toBe(false);
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
  });

  it("validates kind, trade, and requires an actor; 404s cross-bid", async () => {
    await seedEntry();
    expect((await promoteEntry(1, 5, 1, { kind: "NOT_A_KIND" }, ACTOR)).ok).toBe(false);
    expect((await promoteEntry(1, 5, 1, { tradeId: 42 }, ACTOR)).ok).toBe(false);
    expect((await promoteEntry(1, 5, 1, {}, { name: null, email: null })).ok).toBe(false);
    expect(await promoteEntry(2, 5, 1, {}, ACTOR)).toMatchObject({ ok: false, error: "Not found" });
  });
});

describe("linkEntryToItem — cross-meeting continuity (rule 10)", () => {
  it("collects entries from multiple meetings onto ONE Operations item", async () => {
    await seedEntry(); // meeting 5, entry 1
    await promoteEntry(1, 5, 1, {}, ACTOR);
    const itemId = state.prisma.trackedItem.rows[0].id as number;

    await seedEntry({ meetingId: 6, normalizedText: "Mockup still outstanding — chased again" }); // entry 2
    const linked = await linkEntryToItem(1, 6, 2, itemId, ACTOR);
    expect(linked.ok).toBe(true);

    const linkedEntries = state.prisma.meetingRegisterEntry.rows.filter(
      (e) => e.linkedTrackedItemId === itemId
    );
    expect(linkedEntries).toHaveLength(2);
    expect(new Set(linkedEntries.map((e) => e.meetingId))).toEqual(new Set([5, 6]));
    // linking counts as the entry's disposition
    expect(linkedEntries.every((e) => e.reviewState === "PROMOTED_TO_OPERATIONS")).toBe(true);
    // still exactly ONE TrackedItem — no competing register (rule 4)
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
  });

  it("rejects cross-bid items and double-links", async () => {
    await seedEntry();
    await state.prisma.trackedItem.create({ data: { id: 77, bidId: 2, kind: "OAC_ACTION", title: "other bid item" } });
    const crossBid = await linkEntryToItem(1, 5, 1, 77, ACTOR);
    expect(crossBid.ok).toBe(false);

    await state.prisma.trackedItem.create({ data: { id: 78, bidId: 1, kind: "OAC_ACTION", title: "same bid item" } });
    await linkEntryToItem(1, 5, 1, 78, ACTOR);
    const again = await linkEntryToItem(1, 5, 1, 78, ACTOR);
    expect(again.ok).toBe(false);
  });
});
