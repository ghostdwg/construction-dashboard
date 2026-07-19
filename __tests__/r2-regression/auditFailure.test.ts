// R2 auth/durability regression pack — Area F: audit and domain-history
// failure.
//
// Authoritative-history determination (from source reading, not testable
// directly — recorded here for the coverage matrix):
//   - TrackedItem / FieldReport: no separate domain-history table. AuditEvent
//     is the only accountability record; the mutated row itself is domain
//     history. lib/services/trackedItems/index.ts and
//     lib/services/fieldReports/index.ts write AuditEvent INSIDE the same
//     $transaction as the mutation via persistAuditEnvelope (throws on
//     failure) — FAIL-CLOSED.
//   - Meeting Register: MeetingRegisterEntryRevision is a genuine SECOND,
//     domain-specific, append-only history table, written in the same
//     transaction as AuditEvent (also fail-closed) — see
//     lib/services/meetingRegister/{register,promotion,corrections}.ts.
//   - Consultant Report / Observation accept/link/relink (state-changing
//     mutations): the mandatory audit/history record is REQUIRED to commit
//     atomically with the product mutation — a broken audit store must roll
//     the whole mutation back — FAIL-CLOSED. This is the target contract;
//     see the REQUIRED FAIL-CLOSED block below.
//
//     NOTE for whoever runs this pack against THIS branch's own
//     lib/services/consultantReports/observations.ts: that code on this
//     branch still routes accept/link/relink through the legacy
//     lib/services/consultantReports/index.ts `audit()` helper, which wraps
//     its call in try/catch and swallows failures (FAIL-OPEN) — the exact
//     gap this pack originally exposed. The three assertions below will
//     therefore FAIL against this branch's own unfixed product code; that is
//     expected and is not a test bug. This is an independent, test-only
//     branch (see CLAUDE.md/AGENTS.md scope) — it intentionally does not
//     carry the product fix. These assertions exist to validate the
//     REQUIRED contract against the repaired candidate that does carry the
//     fix (in-transaction persistAuditEnvelope via a dedicated
//     writeConsultantAuditTx helper, mirroring the trackedItems/fieldReports
//     pattern). Do not weaken these assertions to make them pass on this
//     branch — do not port the product fix into this test-only branch.
//
// Independent proofs (fresh fixtures, not copies of the existing
// trackedItems.test.ts / fieldReports.test.ts atomicity tests) plus the
// consultant-observation fail-closed contract the mission asked for.

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

import { createTrackedItem, updateTrackedItem } from "@/lib/services/trackedItems";
import { createFieldReport } from "@/lib/services/fieldReports";
import {
  acceptObservationAsNewItem,
  linkObservationToItem,
  relinkObservation,
} from "@/lib/services/consultantReports/observations";

function breakAuditWrites() {
  const original = state.prisma.auditEvent.create;
  state.prisma.auditEvent.create = async () => {
    throw new Error("simulated audit-store failure");
  };
  return () => {
    state.prisma.auditEvent.create = original;
  };
}

beforeEach(async () => {
  state.prisma = buildPrisma();
  await state.prisma.bid.create({ data: { id: BID_A, projectName: "Bid A" } });
});

describe("TrackedItem — fail-closed audit atomicity (independent proof)", () => {
  it("an audit-store failure rolls the create back entirely — zero TrackedItem rows persist", async () => {
    const restore = breakAuditWrites();
    await expect(createTrackedItem(BID_A, { kind: "OAC_ACTION", title: "Should not persist" }, ACTOR_A)).rejects.toThrow(
      "simulated audit-store failure"
    );
    restore();
    expect(state.prisma.trackedItem.rows).toHaveLength(0);
  });

  it("update on a nonexistent item emits NO audit row at all (not-found is checked before the transaction opens)", async () => {
    const result = await updateTrackedItem(BID_A, 99999, { title: "x" }, ACTOR_A);
    expect(result.ok).toBe(false);
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });

  it("update with an invalid priority is rejected before any audit/mutation — zero committed rows", async () => {
    const created = await createTrackedItem(BID_A, { kind: "OAC_ACTION", title: "Real item" }, ACTOR_A);
    expect(created.ok).toBe(true);
    const auditCountAfterCreate = state.prisma.auditEvent.rows.length;
    const result = await updateTrackedItem(BID_A, created.ok ? created.value.id : -1, { priority: "NOT_A_PRIORITY" }, ACTOR_A);
    expect(result.ok).toBe(false);
    expect(state.prisma.auditEvent.rows).toHaveLength(auditCountAfterCreate); // unchanged
  });
});

describe("FieldReport — fail-closed audit atomicity (independent proof)", () => {
  it("an audit-store failure rolls the create back — zero FieldReport rows persist", async () => {
    const restore = breakAuditWrites();
    await expect(createFieldReport(BID_A, { title: "Should not persist" }, ACTOR_A)).rejects.toThrow("simulated audit-store failure");
    restore();
    expect(state.prisma.fieldReport.rows).toHaveLength(0);
  });
});

describe("post-commit stdout telemetry is not part of the durability contract", () => {
  it("the mutation and its AuditEvent are already DB-durable by the time telemetry runs — a telemetry failure cannot un-persist them", async () => {
    // Force the stdout branch to actually execute (this pack normally runs
    // with OBSERVABILITY_AUDIT_QUIET=true, which short-circuits it) and make
    // it throw, to prove durability does not depend on telemetry succeeding.
    const priorQuiet = process.env.OBSERVABILITY_AUDIT_QUIET;
    process.env.OBSERVABILITY_AUDIT_QUIET = "false";
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("simulated stdout/telemetry failure");
    });

    let threw = false;
    try {
      await createTrackedItem(BID_A, { kind: "OAC_ACTION", title: "Durable despite telemetry failure" }, ACTOR_A);
    } catch {
      threw = true;
    }

    consoleSpy.mockRestore();
    process.env.OBSERVABILITY_AUDIT_QUIET = priorQuiet;

    // The telemetry call is unguarded (emitAuditEnvelopeStdout is invoked
    // AFTER `await prisma.$transaction(...)` resolves, with no try/catch
    // around it), so a stdout failure surfaces as an unhandled rejection to
    // the caller — but the DB commit already happened before that call ran.
    expect(threw).toBe(true);
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
    expect(state.prisma.auditEvent.rows).toHaveLength(1);
  });
});

describe("REQUIRED FAIL-CLOSED — ConsultantObservation accept/link/relink must roll back on audit failure, matching TrackedItem/FieldReport", () => {
  // The repaired contract: accept-as-new-item, link, and relink each commit
  // their product mutation and the mandatory AuditEvent/history record
  // atomically (in-transaction, e.g. persistAuditEnvelope via a dedicated
  // writeConsultantAuditTx-style helper) — the same fail-closed shape already
  // proven above for TrackedItem/FieldReport. A broken audit store must
  // reject the call and leave ZERO trace of the attempted mutation: no
  // TrackedItem row, no observation state advance, no committed AuditEvent.
  //
  // This inverts the pack's original pinned finding (accept/link previously
  // committed fail-open through the legacy try/catch-wrapped `audit()`
  // helper). See this file's header for why these assertions fail against
  // this test-only branch's own unfixed product code, and pass against the
  // repaired candidate.
  it("acceptObservationAsNewItem rolls back entirely when AuditEvent writes are broken — zero TrackedItem row, observation state unchanged", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obs = await state.prisma.consultantObservation.create({
      data: { reportId: report.id, bidId: BID_A, observationText: "unauthorized deviation observed" },
    });
    const restore = breakAuditWrites();

    await expect(
      acceptObservationAsNewItem(BID_A, report.id as number, obs.id as number, { title: "Fix deviation" }, ACTOR_A)
    ).rejects.toThrow("simulated audit-store failure");

    restore();

    // Contrast with the old fail-open behavior: no TrackedItem persists, and
    // the observation never leaves ENTERED — the mutation and its
    // accountability record commit together or not at all.
    expect(state.prisma.trackedItem.rows).toHaveLength(0);
    expect(state.prisma.consultantObservation.rows[0].state).toBe("ENTERED");
    expect(state.prisma.consultantObservation.rows[0].registerItemId).toBeNull();
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });

  it("linkObservationToItem rolls back entirely when AuditEvent writes are broken — link never recorded", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obs = await state.prisma.consultantObservation.create({
      data: { reportId: report.id, bidId: BID_A, observationText: "crack observed" },
    });
    const item = await state.prisma.trackedItem.create({ data: { bidId: BID_A, kind: "JSO_ITEM", title: "Existing item" } });
    const restore = breakAuditWrites();

    await expect(
      linkObservationToItem(BID_A, report.id as number, obs.id as number, item.id as number, ACTOR_A)
    ).rejects.toThrow("simulated audit-store failure");

    restore();

    expect(state.prisma.consultantObservation.rows[0].state).toBe("ENTERED");
    expect(state.prisma.consultantObservation.rows[0].registerItemId).toBeNull();
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });

  it("relinkObservation rolls back entirely when AuditEvent writes are broken — prior link untouched", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obs = await state.prisma.consultantObservation.create({
      data: { reportId: report.id, bidId: BID_A, observationText: "crack observed" },
    });
    const itemA = await state.prisma.trackedItem.create({ data: { bidId: BID_A, kind: "JSO_ITEM", title: "First item" } });
    const itemB = await state.prisma.trackedItem.create({ data: { bidId: BID_A, kind: "JSO_ITEM", title: "Second item" } });

    // Establish the prior link with a healthy audit store first — only the
    // relink attempt itself exercises the broken-audit path.
    const linked = await linkObservationToItem(BID_A, report.id as number, obs.id as number, itemA.id as number, ACTOR_A);
    expect(linked.ok).toBe(true);
    const auditCountAfterLink = state.prisma.auditEvent.rows.length;

    const restore = breakAuditWrites();

    await expect(
      relinkObservation(BID_A, report.id as number, obs.id as number, itemB.id as number, ACTOR_A)
    ).rejects.toThrow("simulated audit-store failure");

    restore();

    // The relink correction must not partially apply: the observation stays
    // linked to the FIRST item, and no new AuditEvent row was committed for
    // the failed relink attempt.
    expect(state.prisma.consultantObservation.rows[0].state).toBe("ACCEPTED_LINKED_ITEM");
    expect(state.prisma.consultantObservation.rows[0].registerItemId).toBe(itemA.id);
    expect(state.prisma.auditEvent.rows).toHaveLength(auditCountAfterLink);
  });
});
