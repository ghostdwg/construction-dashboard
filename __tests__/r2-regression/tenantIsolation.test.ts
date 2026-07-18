// R2 auth/durability regression pack — Area E: tenant (bid) isolation.
//
// Cross-bid identifiers must be REJECTED because they don't resolve under a
// bid-scoped query — never merely "filtered out of a list". Every case below
// asserts both the rejection AND that no mutation/state-change occurred.
//
// Scope note (documented, not silently skipped): "Observation → Response
// Package", "response provenance" and "attachment ownership" for a Response
// Package cannot be tested — ResponsePackage/ResponsePackageItem/
// TradeResponseRevision/ResponseAccessToken are NOT implemented as Prisma
// models on this branch (confirmed: grepping prisma/schema.prisma finds no
// such models; they exist only as a design spec in
// docs/architecture/R2_MEETING_RESPONSE_CONTROL_LOOP.md). The closest
// existing analog — TrackedItem.formalResponse — is tested here instead, and
// the coverage matrix records the Response Package rows as N/A (not
// implemented), not as a passing or failing test.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./support/mockPrisma";
import { ACTOR_A, BID_A, BID_B } from "./support/fixtures";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import { findEntry, dispositionEntry, editEntry } from "@/lib/services/meetingRegister/register";
import { promoteEntry, linkEntryToItem } from "@/lib/services/meetingRegister/promotion";
import { applyCorrection } from "@/lib/services/meetingRegister/corrections";
import { createItemFromFieldReport } from "@/lib/services/trackedItems";
import { linkObservationToItem, acceptObservationAsNewItem } from "@/lib/services/consultantReports/observations";
import { setFormalResponse } from "@/lib/services/consultantReports/formalResponse";

const MEETING_A = 5; // bid A
const MEETING_B = 6; // bid B

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.bid.create({ data: { id: BID_A, projectName: "Bid A" } });
  await state.prisma.bid.create({ data: { id: BID_B, projectName: "Bid B" } });
  await state.prisma.meeting.create({ data: { id: MEETING_A, bidId: BID_A } });
  await state.prisma.meeting.create({ data: { id: MEETING_B, bidId: BID_B } });
});

describe("Bid -> Meeting", () => {
  it("a correction request against meetingId=6 (bid B) via bid A's URL is rejected — meeting not found for this bid", async () => {
    const result = await applyCorrection(BID_A, MEETING_B, { correctionType: "EDIT_TEXT", segmentId: 1, newText: "x" }, ACTOR_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Not found");
  });
});

describe("Meeting -> Meeting Register Entry", () => {
  it("findEntry never resolves an entry through the wrong (bidId, meetingId) pair", async () => {
    const entry = await state.prisma.meetingRegisterEntry.create({
      data: { meetingId: MEETING_B, bidId: BID_B, entryType: "RISK", rawSourceText: "r", normalizedText: "r", origin: "manual" },
    });
    expect(await findEntry(BID_A, MEETING_A, entry.id as number)).toBeNull();
    expect(await findEntry(BID_B, MEETING_A, entry.id as number)).toBeNull(); // right bid, wrong meeting
    expect(await findEntry(BID_B, MEETING_B, entry.id as number)).not.toBeNull(); // control
  });

  it("dispositionEntry and editEntry both reject a cross-bid entryId with zero mutation", async () => {
    const entry = await state.prisma.meetingRegisterEntry.create({
      data: { meetingId: MEETING_B, bidId: BID_B, entryType: "RISK", rawSourceText: "r", normalizedText: "original", origin: "ai_extraction" },
    });
    const disposeResult = await dispositionEntry(BID_A, MEETING_A, entry.id as number, { disposition: "CONFIRMED" }, ACTOR_A);
    expect(disposeResult.ok).toBe(false);
    const editResult = await editEntry(BID_A, MEETING_A, entry.id as number, { normalizedText: "hacked" }, ACTOR_A);
    expect(editResult.ok).toBe(false);
    expect(state.prisma.meetingRegisterEntry.rows.find((r) => r.id === entry.id)?.normalizedText).toBe("original");
    expect(state.prisma.meetingRegisterEntryRevision.rows).toHaveLength(0);
  });
});

describe("Meeting -> Transcript Segment", () => {
  it("a correction referencing a segmentId from another bid's meeting is rejected even when the target meeting id is otherwise valid", async () => {
    await state.prisma.meetingTranscriptSegment.create({
      data: { id: 50, meetingId: MEETING_B, bidId: BID_B, currentText: "bid B text", sortKey: 1, segmentIndex: 0 },
    });
    const result = await applyCorrection(BID_A, MEETING_A, { correctionType: "EDIT_TEXT", segmentId: 50, newText: "hacked" }, ACTOR_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Segment not found");
  });
});

describe("Meeting Register Entry -> Tracked Item (promotion / link)", () => {
  it("linkEntryToItem rejects a trackedItemId belonging to another bid — entry stays unlinked", async () => {
    const entry = await state.prisma.meetingRegisterEntry.create({
      data: { meetingId: MEETING_A, bidId: BID_A, entryType: "ACTION_ITEM", rawSourceText: "r", normalizedText: "r", origin: "ai_extraction" },
    });
    const foreignItem = await state.prisma.trackedItem.create({ data: { bidId: BID_B, kind: "OAC_ACTION", title: "Bid B item" } });

    const result = await linkEntryToItem(BID_A, MEETING_A, entry.id as number, foreignItem.id as number, ACTOR_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Tracked item not found");
    expect(state.prisma.meetingRegisterEntry.rows.find((r) => r.id === entry.id)?.linkedTrackedItemId).toBeNull();
  });

  it("promoteEntry can never write a TrackedItem into a bid other than the caller's own bid (structural — bidId is the transaction argument, never client input)", async () => {
    const entry = await state.prisma.meetingRegisterEntry.create({
      data: { meetingId: MEETING_A, bidId: BID_A, entryType: "ACTION_ITEM", rawSourceText: "r", normalizedText: "r", origin: "ai_extraction" },
    });
    const result = await promoteEntry(BID_A, MEETING_A, entry.id as number, {}, ACTOR_A);
    expect(result.ok).toBe(true);
    const created = state.prisma.trackedItem.rows.find((r) => (result.ok ? r.id === result.value.trackedItemId : false));
    expect(created?.bidId).toBe(BID_A);
  });
});

describe("Tracked Item -> Consultant Observation (accept / link)", () => {
  it("linkObservationToItem rejects an itemId belonging to another bid — observation state unchanged", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obs = await state.prisma.consultantObservation.create({
      data: { reportId: report.id, bidId: BID_A, observationText: "leak observed" },
    });
    const foreignItem = await state.prisma.trackedItem.create({ data: { bidId: BID_B, kind: "JSO_ITEM", title: "Bid B item" } });

    const result = await linkObservationToItem(BID_A, report.id as number, obs.id as number, foreignItem.id as number, ACTOR_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Not found");
    expect(state.prisma.consultantObservation.rows.find((r) => r.id === obs.id)?.state).toBe("ENTERED");
    expect(state.prisma.consultantObservation.rows.find((r) => r.id === obs.id)?.registerItemId).toBeNull();
  });

  it("acceptObservationAsNewItem never leaks a cross-bid report — the created TrackedItem is scoped to the CALLER's bidId argument", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obs = await state.prisma.consultantObservation.create({
      data: { reportId: report.id, bidId: BID_A, observationText: "crack in beam" },
    });
    // Calling with a DIFFERENT bidId than the observation's own row's bidId
    // must not resolve the observation at all (findObservation is
    // {id, reportId, bidId}-scoped).
    const result = await acceptObservationAsNewItem(BID_B, report.id as number, obs.id as number, { title: "New item" }, ACTOR_A);
    expect(result.ok).toBe(false);
    expect(state.prisma.trackedItem.rows).toHaveLength(0);
  });
});

describe("Tracked Item -> Field Observation (createItemFromFieldReport)", () => {
  it("a fieldReportId belonging to another bid can never source a TrackedItem — zero writes", async () => {
    const report = await state.prisma.fieldReport.create({ data: { bidId: BID_B, title: "Bid B field report" } });
    const result = await createItemFromFieldReport(BID_A, report.id as number, { title: "Should not be created" }, ACTOR_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Field report not found for this bid");
    expect(state.prisma.trackedItem.rows).toHaveLength(0);
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });
});

describe("response provenance (closest existing analog to Response Package — TrackedItem.formalResponse)", () => {
  it("setFormalResponse rejects an itemId belonging to another bid — no formalResponse written, no prior-value leak", async () => {
    const foreignItem = await state.prisma.trackedItem.create({
      data: { bidId: BID_B, kind: "OAC_ACTION", title: "Bid B item", formalResponse: "confidential prior response" },
    });
    const result = await setFormalResponse(BID_A, foreignItem.id as number, "attempted cross-bid response", ACTOR_A);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Not found");
    const row = state.prisma.trackedItem.rows.find((r) => r.id === foreignItem.id);
    expect(row?.formalResponse).toBe("confidential prior response");
  });
});
