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
//   - Consultant Report / Observation: uses the LEGACY emitAuditEvent() /
//     audit() path (lib/services/consultantReports/index.ts `audit()`),
//     which wraps its call in try/catch and swallows any failure — FAIL
//     OPEN. This is a real, reproducible asymmetry with the two fail-closed
//     domains above, confirmed below.
//
// Independent proofs (fresh fixtures, not copies of the existing
// trackedItems.test.ts / fieldReports.test.ts atomicity tests) plus the
// consultant-observation fail-open exposure the mission asked for.

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
import { acceptObservationAsNewItem, linkObservationToItem } from "@/lib/services/consultantReports/observations";

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

describe("EXPECTED PRODUCT FAILURE — ConsultantObservation mutations are audit FAIL-OPEN, unlike TrackedItem/FieldReport", () => {
  // lib/services/consultantReports/index.ts `audit()` wraps emitAuditEvent()
  // in try/catch and swallows any failure (a console.error only); the
  // TrackedItem/observation-state mutation itself already committed via its
  // own (audit-free) prisma call before `audit()` is even invoked. This is
  // architecturally different from trackedItems/fieldReports, where the
  // AuditEvent write is INSIDE the same $transaction as the mutation.
  //
  // This test pins CURRENT behavior: the mutation SUCCEEDS even when the
  // audit store is completely broken, silently losing the accountability
  // trail. It is not a test-infrastructure bug and not a request to fix
  // product code in this branch — it is the regression-pack's job to make
  // this gap visible and durable across reruns.
  it("acceptObservationAsNewItem COMMITS the new TrackedItem even when AuditEvent writes are broken (no rollback)", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obs = await state.prisma.consultantObservation.create({
      data: { reportId: report.id, bidId: BID_A, observationText: "unauthorized deviation observed" },
    });
    const restore = breakAuditWrites();

    const result = await acceptObservationAsNewItem(BID_A, report.id as number, obs.id as number, { title: "Fix deviation" }, ACTOR_A);

    restore();

    // Contrast with TrackedItem/FieldReport (above): those REJECT (throw) and
    // roll back to zero rows under the identical failure. This does not.
    expect(result.ok).toBe(true);
    expect(state.prisma.trackedItem.rows).toHaveLength(1);
    expect(state.prisma.consultantObservation.rows[0].state).toBe("ACCEPTED_NEW_ITEM");
    // And the accountability trail this mutation SHOULD have produced is
    // simply absent — no AuditEvent row exists for an operational-register
    // mutation that unambiguously happened.
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });

  it("linkObservationToItem also COMMITS the link even when AuditEvent writes are broken (no rollback)", async () => {
    const report = await state.prisma.consultantReport.create({ data: { bidId: BID_A, vendorName: "V", reportType: "OTHER_CONSULTANT_REPORT" } });
    const obs = await state.prisma.consultantObservation.create({
      data: { reportId: report.id, bidId: BID_A, observationText: "crack observed" },
    });
    const item = await state.prisma.trackedItem.create({ data: { bidId: BID_A, kind: "JSO_ITEM", title: "Existing item" } });
    const restore = breakAuditWrites();

    const result = await linkObservationToItem(BID_A, report.id as number, obs.id as number, item.id as number, ACTOR_A);

    restore();

    expect(result.ok).toBe(true);
    expect(state.prisma.consultantObservation.rows[0].state).toBe("ACCEPTED_LINKED_ITEM");
    expect(state.prisma.consultantObservation.rows[0].registerItemId).toBe(item.id);
    expect(state.prisma.auditEvent.rows).toHaveLength(0);
  });
});
