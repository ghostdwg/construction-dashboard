import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: number };
  type State = { observations: Row[]; tracked: Row[]; assignments: Row[]; audits: Row[] };
  const holder = { state: {} as State, active: {} as State, failAudit: false, nextId: 30 };
  const db: Record<string, unknown> = {};
  const current = () => holder.active;
  db.$transaction = async (callback: (tx: typeof db) => Promise<unknown>) => {
    const draft = structuredClone(holder.state); holder.active = draft;
    try { const result = await callback(db); holder.state = draft; return result; }
    finally { holder.active = holder.state; }
  };
  db.fieldReport = { findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) => where.id === 5 && where.bidId === 7 ? { id: 5 } : null) };
  db.consultantReport = { findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) => where.id === 6 && where.bidId === 7 ? { id: 6 } : null) };
  db.reportObservation = {
    findMany: vi.fn(async () => current().observations),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: holder.nextId++, disposition: "OPEN", registerItemId: null, ...data } as Row; current().observations.push(row); return { id: row.id }; }),
    findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) => current().observations.find((row) => row.id === where.id && row.bidId === where.bidId) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => { const row = current().observations.find((entry) => entry.id === where.id)!; Object.assign(row, data); return row; }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const rows = current().observations.filter((row) => row.id === where.id && row.bidId === where.bidId && (where.disposition === undefined || row.disposition === where.disposition) && (where.registerItemId !== null || row.registerItemId == null));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
  };
  db.trackedItem = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: holder.nextId++, ...data } as Row; current().tracked.push(row); return { id: row.id }; }),
    findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) => current().tracked.find((row) => row.id === where.id && row.bidId === where.bidId) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => { const row = current().tracked.find((entry) => entry.id === where.id)!; Object.assign(row, data); return row; }),
  };
  db.bidTrade = { count: vi.fn(async ({ where }: { where: { bidId: number; tradeId: { in: number[] } } }) => where.tradeId.in.filter((tradeId) => where.bidId === 7 && [1, 2].includes(tradeId)).length) };
  db.bidInviteSelection = { findFirst: vi.fn(async ({ where }: { where: { bidId: number; subcontractorId: number } }) => where.bidId === 7 && where.subcontractorId === 3 ? { id: 1 } : null) };
  db.trackedItemTradeAssignment = {
    deleteMany: vi.fn(async ({ where }: { where: { trackedItemId: number } }) => { current().assignments = current().assignments.filter((row) => row.trackedItemId !== where.trackedItemId); }),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: holder.nextId++, ...data } as Row; current().assignments.push(row); return row; }),
  };
  db.auditEvent = { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { if (holder.failAudit) throw new Error("audit injection"); const row = { id: holder.nextId++, ...data } as Row; current().audits.push(row); return row; }) };
  const exposed = { db, reset() { holder.state = { observations: [], tracked: [{ id: 10, bidId: 7, title: "Existing", dueDate: new Date("2026-08-03") }], assignments: [], audits: [] }; holder.active = holder.state; holder.failAudit = false; holder.nextId = 30; } } as typeof holder & { db: typeof db; reset(): void };
  Object.defineProperties(exposed, {
    state: { get: () => holder.state, set: (value: State) => { holder.state = value; holder.active = value; } },
    active: { get: () => holder.active, set: (value: State) => { holder.active = value; } },
    failAudit: { get: () => holder.failAudit, set: (value: boolean) => { holder.failAudit = value; } },
    nextId: { get: () => holder.nextId, set: (value: number) => { holder.nextId = value; } },
  });
  return exposed;
});

vi.mock("@/lib/prisma", () => ({ prisma: h.db }));
vi.mock("@/lib/observability/audit", () => ({
  buildAuditEnvelope: (input: Record<string, unknown>) => ({ schemaVersion: "1", category: input.category, action: input.action, severity: input.severity, timestamp: new Date().toISOString(), correlationId: null, replayId: null, ingestionId: null, runnerId: null, actor: input.actor, subject: input.subject, versions: {}, decision: input.decision, reasonLog: [], payload: input.payload }),
  persistAuditEnvelope: async (db: { auditEvent: { create(args: { data: Record<string, unknown> }): Promise<unknown> } }, envelope: Record<string, unknown>) => db.auditEvent.create({ data: envelope }),
  emitAuditEnvelopeStdout: vi.fn(),
}));

import { assignTrackedItemTrades, createReportObservation, dispositionObservation, linkObservation, promoteObservation, updateOpenObservation } from "../observations";

const actor = { id: "gc-1", email: "gc@example.test" };
beforeEach(() => h.reset());

describe("ReportObservation freeze, Operations linkage, and bid-owned assignments", () => {
  test("invalid observation dates fail before persistence", async () => {
    expect(await createReportObservation(7, { sourceKind: "direct_entry", observationText: "date probe", observedAt: new Date("invalid") }, actor)).toEqual({ ok: false, error: "Invalid observed date" });
    expect(h.state.observations).toHaveLength(0);
  });

  test("source parent must belong to the bid and exactly one source is set", async () => {
    expect((await createReportObservation(8, { sourceKind: "field_report", fieldReportId: 5, observationText: "foreign" }, actor))).toEqual({ ok: false, error: "Not found" });
    expect((await createReportObservation(7, { sourceKind: "field_report", fieldReportId: 5, consultantReportId: 6, observationText: "two sources" }, actor))).toEqual({ ok: false, error: "Not found" });
    const created = await createReportObservation(7, { sourceKind: "field_report", fieldReportId: 5, observationText: "Verbatim field condition", sourceLocator: "p.2/photo 4" }, actor);
    expect(created.ok).toBe(true);
    expect(h.state.observations[0]).toMatchObject({ bidId: 7, fieldReportId: 5, disposition: "OPEN" });
  });

  test("verbatim fields freeze immediately after human disposition", async () => {
    await createReportObservation(7, { sourceKind: "direct_entry", observationText: "Original wording" }, actor);
    const id = h.state.observations[0].id;
    expect((await updateOpenObservation(7, id, { observationText: "Corrected while open" }, actor)).ok).toBe(true);
    expect((await dispositionObservation(7, id, { disposition: "ACCEPTED" }, actor)).ok).toBe(true);
    expect(await updateOpenObservation(7, id, { observationText: "Forbidden rewrite" }, actor)).toEqual({ ok: false, error: "Verbatim observation fields are frozen" });
    expect(h.state.observations[0].observationText).toBe("Corrected while open");
  });

  test("accepted observations promote to or link with the sole TrackedItem register and foreign links are 404", async () => {
    await createReportObservation(7, { sourceKind: "field_report", fieldReportId: 5, observationText: "Masonry repair" }, actor);
    const id = h.state.observations[0].id;
    await dispositionObservation(7, id, { disposition: "ACCEPTED" }, actor);
    const promoted = await promoteObservation(7, id, {}, actor);
    expect(promoted.ok).toBe(true);
    expect(h.state.tracked.at(-1)).toMatchObject({ kind: "FIELD_ITEM", sourceKind: "field_report", sourceFieldReportId: 5, sourceReportObservationId: id });
    await createReportObservation(7, { sourceKind: "direct_entry", observationText: "Link me" }, actor);
    const linkId = h.state.observations.at(-1)!.id;
    await dispositionObservation(7, linkId, { disposition: "ACCEPTED" }, actor);
    expect(await linkObservation(8, linkId, 10, actor)).toEqual({ ok: false, error: "Not found" });
    expect((await linkObservation(7, linkId, 10, actor)).ok).toBe(true);
  });

  test("lead/supporting trades and contractor must be owned by the bid; consultant and contractor dates stay separate", async () => {
    const dueBefore = h.state.tracked[0].dueDate;
    expect(await assignTrackedItemTrades(7, 10, { leadTradeId: 99, responsibleContractorId: 3 }, actor)).toEqual({ ok: false, error: "Not found" });
    expect(await assignTrackedItemTrades(7, 10, { leadTradeId: 1, responsibleContractorId: 999 }, actor)).toEqual({ ok: false, error: "Not found" });
    expect((await assignTrackedItemTrades(7, 10, { leadTradeId: 1, supportingTradeIds: [2], responsibleContractorId: 3, consultantDiscipline: "architect" }, actor)).ok).toBe(true);
    expect(h.state.assignments.map((row) => row.role)).toEqual(["LEAD", "SUPPORTING"]);
    expect(h.state.tracked[0].dueDate).toEqual(dueBefore);
  });

  test("observation audit failure rolls the mutation back", async () => {
    h.failAudit = true;
    const before = structuredClone(h.state);
    await expect(createReportObservation(7, { sourceKind: "direct_entry", observationText: "Must rollback" }, actor)).rejects.toThrow("audit injection");
    expect(h.state).toEqual(before);
  });
});
