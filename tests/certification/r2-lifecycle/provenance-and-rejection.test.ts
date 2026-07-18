// R2 Local Certification Harness — Provenance and rejection scenarios 7-10, 23.
//
// Scenarios 8 and 9 exercise REAL, IMPLEMENTED production code
// (lib/services/trackedItems/index.ts `promoteMeetingActionItem`) against a
// mocked Prisma client — no DB, no network, following the repo's existing
// mocked-Prisma test idiom (see app/api/bids/[id]/tracked-items/__tests__/routes.test.ts).
// Scenarios 7, 10, 23 exercise the FIXTURE_SIMULATED Build 3 engine.
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  buildCrossBidProvenanceRejectionScenario,
  buildCrossMeetingProvenanceRejectionFixtures,
  buildDuplicateRegisterPromotionRejectionFixtures,
  buildDuplicateResponsePackageLinkingRejectionScenario,
  buildProvenanceTraceabilityScenario,
} from "@/tests/fixtures/r2-lifecycle/scenarioBuilders";

describe("Scenario 7 — Cross-bid provenance rejection [FIXTURE_SIMULATED]", () => {
  test("adding an item from a different bid than the package is rejected before any mutation", () => {
    const { pkg, caught, isProvenanceError, sim } = buildCrossBidProvenanceRejectionScenario();
    expect(isProvenanceError).toBe(true);
    expect(caught).toBeInstanceOf(Error);
    expect(pkg.items).toHaveLength(0);
    expect(sim.getAuditLog()).toHaveLength(0); // no audit write for a rejected mutation either
  });
});

describe("Scenario 10 — Duplicate response-package linking rejection [FIXTURE_SIMULATED]", () => {
  test("an item already live in package A cannot be added to package B", () => {
    const { packageA, packageB, isProvenanceError } = buildDuplicateResponsePackageLinkingRejectionScenario();
    expect(isProvenanceError).toBe(true);
    expect(packageA.items).toHaveLength(1);
    expect(packageB.items).toHaveLength(0);
  });
});

describe("Scenario 23 — Source provenance traceable end-to-end [FIXTURE_SIMULATED meeting->package leg]", () => {
  test("chain resolves Meeting -> MeetingActionItem -> TrackedItem -> package item -> compiled -> transmittal -> disposition -> closure", () => {
    const { meeting, actionItem, trackedItem, pkg, transmittal, disposition, closureRecord } = buildProvenanceTraceabilityScenario();
    expect(trackedItem.sourceMeetingId).toBe(meeting.id);
    expect(trackedItem.sourceMeetingActionItemId).toBe(actionItem.id);
    expect(pkg.items.map((i) => i.trackedItemId)).toContain(trackedItem.id);
    expect(disposition.transmittalId).toBe(transmittal.id);
    expect(closureRecord.evidence.some((e) => e.kind === "transmittal" && e.id === transmittal.id)).toBe(true);
    expect(closureRecord.itemStatusSnapshot[0].trackedItemId).toBe(trackedItem.id);
  });
});

// ── Real-service tests (scenarios 8, 9) ─────────────────────────────────────

const h = vi.hoisted(() => ({
  trackedItems: [] as Array<Record<string, unknown> & { id: number; bidId: number; sourceMeetingActionItemId: number | null }>,
  meetingActionItems: [] as Array<Record<string, unknown> & { id: number; bidId: number }>,
  nextId: 1,
}));

vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: vi.fn(async () => undefined) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    meetingActionItem: {
      findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) =>
        h.meetingActionItems.find((m) => m.id === where.id && m.bidId === where.bidId) ?? null
      ),
    },
    trackedItem: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        h.trackedItems.find(
          (i) =>
            (where.sourceMeetingActionItemId === undefined ||
              i.sourceMeetingActionItemId === where.sourceMeetingActionItemId) &&
            (where.id === undefined || i.id === where.id)
        ) ?? null
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (h.trackedItems.some((i) => i.sourceMeetingActionItemId === data.sourceMeetingActionItemId && data.sourceMeetingActionItemId != null)) {
          const err = new Error("UNIQUE constraint failed") as Error & { code: string };
          err.code = "P2002";
          throw err;
        }
        const row = { id: h.nextId++, ...data } as (typeof h.trackedItems)[number];
        h.trackedItems.push(row);
        return { id: row.id };
      }),
    },
  },
}));

describe("Scenario 8 — Cross-meeting provenance rejection [IMPLEMENTED: promoteMeetingActionItem tenancy check]", () => {
  beforeEach(() => {
    h.trackedItems = [];
    h.meetingActionItems = [];
    h.nextId = 1;
  });

  test("promoting a meeting action item that belongs to a foreign bid is rejected (real service code)", async () => {
    const { foreignMeeting, foreignActionItem } = buildCrossMeetingProvenanceRejectionFixtures();
    h.meetingActionItems.push({ id: foreignActionItem.id, bidId: foreignMeeting.bidId });

    const { promoteMeetingActionItem } = await import("@/lib/services/trackedItems/index");
    // Attempt to promote it under the HOME bid (9), not the foreign bid (12)
    // the action item actually belongs to — findFirst({id, bidId: 9}) misses.
    const result = await promoteMeetingActionItem(9, foreignActionItem.id, { name: "Josh" });

    expect(result.ok).toBe(false);
    expect(h.trackedItems).toHaveLength(0); // no partial TrackedItem created
  });
});

describe("Scenario 9 — Duplicate Register promotion rejection [IMPLEMENTED: sourceMeetingActionItemId unique guard]", () => {
  beforeEach(() => {
    h.trackedItems = [];
    h.meetingActionItems = [];
    h.nextId = 1;
  });

  test("promoting the same MeetingActionItem twice is rejected by the pre-check, not just the DB constraint", async () => {
    const { meeting, actionItem } = buildDuplicateRegisterPromotionRejectionFixtures();
    h.meetingActionItems.push({
      id: actionItem.id,
      bidId: meeting.bidId,
      meetingId: meeting.id,
      description: actionItem.description,
      assignedToName: actionItem.assignedToName,
      priority: actionItem.priority,
      dueDate: actionItem.dueDate,
      carriedFromDate: actionItem.carriedFromDate,
      sourceText: actionItem.sourceText,
      source: actionItem.source,
    });

    const { promoteMeetingActionItem } = await import("@/lib/services/trackedItems/index");
    const first = await promoteMeetingActionItem(meeting.bidId, actionItem.id, { name: "Josh" });
    expect(first.ok).toBe(true);

    const second = await promoteMeetingActionItem(meeting.bidId, actionItem.id, { name: "Josh" });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error).toMatch(/already tracked/i);
    }
    expect(h.trackedItems).toHaveLength(1); // exactly one row, no duplicate
  });
});
