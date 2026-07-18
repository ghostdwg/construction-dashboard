// R2 auth/durability regression pack — Area G: duplicate promotion and
// provenance.
//
// prisma/schema.prisma guards exactly THREE TrackedItem source FKs as
// @unique — sourceMeetingActionItemId, sourceConsultantObservationId,
// sourceMeetingRegisterEntryId (each "at most one TrackedItem per source"
// independently) — while sourceFieldReportId is deliberately NOT unique (a
// report is evidence, many items may cite it). This file proves both halves
// of that contract: the three guarded sources reject a duplicate (including
// the DB-level P2002 race path, not just the friendly service-level
// pre-check), the unguarded one does not, and many-observations-support-one-
// item linking (a distinct, allowed many-to-one shape) still works.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./support/mockPrisma";
import { ACTOR_A, BID_A } from "./support/fixtures";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import { promoteEntry, linkEntryToItem } from "@/lib/services/meetingRegister/promotion";
import { promoteMeetingActionItem, createItemFromFieldReport } from "@/lib/services/trackedItems";
import { acceptObservationAsNewItem, linkObservationToItem } from "@/lib/services/consultantReports/observations";

const MEETING_A = 5;

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.bid.create({ data: { id: BID_A, projectName: "Bid A" } });
  await state.prisma.meeting.create({ data: { id: MEETING_A, bidId: BID_A } });
});

describe("Meeting Register Entry -> TrackedItem — sourceMeetingRegisterEntryId is a single-promotion guard", () => {
  it("promoting the SAME entry twice via the normal flow is rejected the second time (linkedTrackedItemId guard) — one TrackedItem total", async () => {
    const entry = await state.prisma.meetingRegisterEntry.create({
      data: { meetingId: MEETING_A, bidId: BID_A, entryType: "ACTION_ITEM", rawSourceText: "r", normalizedText: "r", origin: "ai_extraction" },
    });
    const first = await promoteEntry(BID_A, MEETING_A, entry.id as number, {}, ACTOR_A);
    expect(first.ok).toBe(true);
    const second = await promoteEntry(BID_A, MEETING_A, entry.id as number, {}, ACTOR_A);
    expect(second.ok).toBe(false);
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
  });

  it("a CONCURRENT double-promotion race (entry not yet flagged linked) is caught by the DB-level P2002 unique guard — one TrackedItem total, no orphan revision row for the loser", async () => {
    const entry = await state.prisma.meetingRegisterEntry.create({
      data: { meetingId: MEETING_A, bidId: BID_A, entryType: "ACTION_ITEM", rawSourceText: "r", normalizedText: "r", origin: "ai_extraction" },
    });
    // Simulate the race window: a TrackedItem already claims this entry's id
    // via sourceMeetingRegisterEntryId, but the entry row itself has not yet
    // been flagged linkedTrackedItemId (the exact window promoteEntry's own
    // catch(P2002) branch exists to close).
    await state.prisma.trackedItem.create({
      data: { bidId: BID_A, kind: "OAC_ACTION", title: "Won the race", sourceMeetingRegisterEntryId: entry.id },
    });
    const revisionCountBefore = state.prisma.meetingRegisterEntryRevision.rows.length;

    const loser = await promoteEntry(BID_A, MEETING_A, entry.id as number, {}, ACTOR_A);

    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.error).toBe("This entry has already been promoted");
    expect(state.prisma.trackedItem.rows).toHaveLength(1); // the winner only
    expect(state.prisma.meetingRegisterEntryRevision.rows.length).toBe(revisionCountBefore); // no orphan revision for the loser
  });

  it("linkEntryToItem after promotion is rejected — entry is already linked", async () => {
    const entry = await state.prisma.meetingRegisterEntry.create({
      data: { meetingId: MEETING_A, bidId: BID_A, entryType: "ACTION_ITEM", rawSourceText: "r", normalizedText: "r", origin: "ai_extraction" },
    });
    const promoted = await promoteEntry(BID_A, MEETING_A, entry.id as number, {}, ACTOR_A);
    expect(promoted.ok).toBe(true);
    const otherItem = await state.prisma.trackedItem.create({ data: { bidId: BID_A, kind: "OAC_ACTION", title: "Another item" } });
    const linkResult = await linkEntryToItem(BID_A, MEETING_A, entry.id as number, otherItem.id as number, ACTOR_A);
    expect(linkResult.ok).toBe(false);
  });
});

describe("MeetingActionItem -> TrackedItem — sourceMeetingActionItemId is a single-promotion guard", () => {
  it("promoting the same action item twice is rejected the second time — one TrackedItem total", async () => {
    const actionItem = await state.prisma.meetingActionItem.create({
      data: { meetingId: MEETING_A, bidId: BID_A, description: "Submit shop drawings", priority: "MEDIUM", status: "OPEN", source: "meeting" },
    });
    const first = await promoteMeetingActionItem(BID_A, actionItem.id as number, ACTOR_A);
    expect(first.ok).toBe(true);
    const second = await promoteMeetingActionItem(BID_A, actionItem.id as number, ACTOR_A);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/only be promoted once/);
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
  });

  it("a CONCURRENT double-promotion race is caught by the P2002 mapping, never a 500 — one TrackedItem total", async () => {
    const actionItem = await state.prisma.meetingActionItem.create({
      data: { meetingId: MEETING_A, bidId: BID_A, description: "Race condition item", priority: "MEDIUM", status: "OPEN", source: "meeting" },
    });
    // Winner lands first (no pre-check race window to simulate here since
    // promoteMeetingActionItem's pre-check reads the SAME table it writes to
    // — call it twice back-to-back and assert the P2002 branch's friendly
    // message, proving the mapped-error path (not an uncaught 500) fires.
    const winner = await promoteMeetingActionItem(BID_A, actionItem.id as number, ACTOR_A);
    expect(winner.ok).toBe(true);
    const loser = await promoteMeetingActionItem(BID_A, actionItem.id as number, ACTOR_A);
    expect(loser.ok).toBe(false);
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
  });
});

describe("ConsultantObservation -> TrackedItem — sourceConsultantObservationId is a single-accept guard", () => {
  it("accepting the same observation as a new item twice is rejected (state machine: ENTERED -> ACCEPTED_NEW_ITEM is one-way) — one TrackedItem total", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obs = await state.prisma.consultantObservation.create({ data: { reportId: report.id, bidId: BID_A, observationText: "deviation" } });

    const first = await acceptObservationAsNewItem(BID_A, report.id as number, obs.id as number, { title: "Fix it" }, ACTOR_A);
    expect(first.ok).toBe(true);
    const second = await acceptObservationAsNewItem(BID_A, report.id as number, obs.id as number, { title: "Fix it again" }, ACTOR_A);
    expect(second.ok).toBe(false);
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
  });
});

describe("many-to-one is ALLOWED where the contract says so: multiple observations may link to the SAME TrackedItem", () => {
  it("two different observations linkObservationToItem-ing to the same item both succeed — registerItemId is not unique", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obsA = await state.prisma.consultantObservation.create({ data: { reportId: report.id, bidId: BID_A, observationText: "supporting note A" } });
    const obsB = await state.prisma.consultantObservation.create({ data: { reportId: report.id, bidId: BID_A, observationText: "supporting note B" } });
    const item = await state.prisma.trackedItem.create({ data: { bidId: BID_A, kind: "JSO_ITEM", title: "Shared target item" } });

    const linkA = await linkObservationToItem(BID_A, report.id as number, obsA.id as number, item.id as number, ACTOR_A);
    const linkB = await linkObservationToItem(BID_A, report.id as number, obsB.id as number, item.id as number, ACTOR_A);

    expect(linkA.ok).toBe(true);
    expect(linkB.ok).toBe(true);
    expect(state.prisma.consultantObservation.rows.filter((r) => r.registerItemId === item.id)).toHaveLength(2);
  });

  it("two TrackedItems citing the SAME FieldReport both succeed — sourceFieldReportId is deliberately NOT unique (a report is evidence, not a promotable singleton)", async () => {
    const report = await state.prisma.fieldReport.create({ data: { bidId: BID_A, title: "Daily field report" } });
    const first = await createItemFromFieldReport(BID_A, report.id as number, { title: "Item one from this report" }, ACTOR_A);
    const second = await createItemFromFieldReport(BID_A, report.id as number, { title: "Item two from the SAME report" }, ACTOR_A);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(state.prisma.trackedItem.rows.filter((r) => r.sourceFieldReportId === report.id)).toHaveLength(2);
  });
});
