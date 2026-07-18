import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => {
  type Row = Record<string, unknown> & { id: number };
  type State = { packages: Row[]; items: Row[]; tracked: Row[]; responses: Row[]; tokens: Array<Record<string, unknown> & { id: string }>; attachments: Row[]; audits: Row[] };
  const holder = { state: {} as State, active: {} as State, failAudit: false, nextId: 20 };
  const db: Record<string, unknown> = {};
  const current = () => holder.active;
  db.$transaction = async (callback: (tx: typeof db) => Promise<unknown>) => {
    const draft = structuredClone(holder.state);
    holder.active = draft;
    try {
      const result = await callback(db);
      holder.state = draft;
      return result;
    } finally {
      holder.active = holder.state;
    }
  };
  db.bidInviteSelection = { findFirst: vi.fn(async ({ where }: { where: { bidId: number; subcontractorId: number } }) => where.bidId === 7 && where.subcontractorId === 3 ? { id: 1 } : null) };
  db.responsePackage = {
    aggregate: vi.fn(async ({ where }: { where: { bidId: number } }) => ({ _max: { packageNumber: Math.max(0, ...current().packages.filter((row) => row.bidId === where.bidId).map((row) => Number(row.packageNumber))) } })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: holder.nextId++, status: "DRAFT", ...data } as Row; current().packages.push(row); return { id: row.id, packageNumber: row.packageNumber }; }),
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async ({ where, include, select }: { where: Record<string, unknown>; include?: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = current().packages.find((entry) => entry.id === where.id && entry.bidId === where.bidId);
      if (!row || (where.status && typeof where.status === "object" && row.status === "VOIDED")) return null;
      const members = current().items.filter((item) => item.packageId === row.id && item.bidId === row.bidId);
      if (include && "_count" in include) return { ...row, _count: { items: members.length } };
      if (include && "items" in include) return { ...row, items: members.map((item) => ({ id: item.id, responses: current().responses.filter((response) => response.packageItemId === item.id).sort((a, b) => Number(b.revisionIndex) - Number(a.revisionIndex)).slice(0, 1).map((response) => ({ id: response.id, gcReview: response.gcReview })) })) };
      if (select && "items" in select) return { id: row.id, packageNumber: row.packageNumber, title: row.title, responseDueDate: row.responseDueDate, status: row.status, items: members.map((item) => ({ id: item.id, displayNumber: item.displayNumber, trackedItem: { title: "Assigned item", description: "Only assigned description", sourceLocator: "p.2", dueDate: null }, responses: current().responses.filter((response) => response.packageItemId === item.id).map((response) => ({ ...response, attachments: [] })) })) };
      return { ...row };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => { const row = current().packages.find((entry) => entry.id === where.id)!; Object.assign(row, data); return row; }),
  };
  db.responsePackageItem = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: holder.nextId++, ...data } as Row; current().items.push(row); return { id: row.id }; }),
    delete: vi.fn(async ({ where }: { where: { id: number } }) => { current().items = current().items.filter((row) => row.id !== where.id); }),
    findFirst: vi.fn(async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, unknown> }) => {
      const row = current().items.find((entry) => entry.id === where.id || (entry.packageId === where.packageId && entry.trackedItemId === where.trackedItemId));
      if (!row || (where.packageId !== undefined && row.packageId !== where.packageId) || (where.bidId !== undefined && row.bidId !== where.bidId)) return null;
      const pkg = current().packages.find((entry) => entry.id === row.packageId)!;
      return select && "package" in select ? { id: row.id, package: { status: pkg.status } } : { id: row.id };
    }),
  };
  db.trackedItem = { findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) => current().tracked.find((row) => row.id === where.id && row.bidId === where.bidId) ?? null) };
  db.responseAccessToken = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `tok-${holder.nextId++}`, ...data } as State["tokens"][number]; current().tokens.push(row); return { id: row.id }; }),
    findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => current().tokens.find((row) => row.tokenHash === where.tokenHash) ?? null),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const row = current().tokens.find((entry) => entry.id === where.id)!; Object.assign(row, data); return row; }),
    updateMany: vi.fn(async ({ where, data }: { where: { packageId: number; bidId: number; revokedAt: null }; data: Record<string, unknown> }) => { const rows = current().tokens.filter((row) => row.packageId === where.packageId && row.bidId === where.bidId && !row.revokedAt); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; }),
  };
  db.tradeResponseRevision = {
    aggregate: vi.fn(async ({ where }: { where: { packageItemId: number } }) => ({ _max: { revisionIndex: Math.max(-1, ...current().responses.filter((row) => row.packageItemId === where.packageItemId).map((row) => Number(row.revisionIndex))) } })),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: holder.nextId++, submittedAt: new Date(), gcReview: "PENDING", ...data } as Row; current().responses.push(row); return { id: row.id, revisionIndex: row.revisionIndex }; }),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = current().responses.find((entry) => entry.id === where.id && entry.bidId === where.bidId && entry.packageItemId === where.packageItemId);
      if (!row) return null;
      const member = current().items.find((entry) => entry.id === row.packageItemId)!;
      const pkg = current().packages.find((entry) => entry.id === member.packageId)!;
      return pkg.status === "GC_REVIEW" ? { id: row.id } : null;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => { const row = current().responses.find((entry) => entry.id === where.id)!; Object.assign(row, data); return row; }),
  };
  db.tradeResponseAttachment = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { const row = { id: holder.nextId++, ...data } as Row; current().attachments.push(row); return { id: row.id }; }),
  };
  db.auditEvent = { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { if (holder.failAudit) throw new Error("audit injection"); const row = { id: holder.nextId++, ...data } as Row; current().audits.push(row); return row; }) };
  const exposed = {
    db,
    reset() { holder.state = { packages: [{ id: 1, bidId: 7, packageNumber: 1, title: "Synthetic package", contractorId: 3, status: "DRAFT", responseDueDate: new Date("2026-08-01"), manualChannel: null }], items: [{ id: 2, packageId: 1, bidId: 7, trackedItemId: 9, displayNumber: "AFR-17.1" }], tracked: [{ id: 9, bidId: 7, dueDate: new Date("2026-07-25"), consultantTargetDate: new Date("2026-07-20") }], responses: [], tokens: [], attachments: [], audits: [] }; holder.active = holder.state; holder.failAudit = false; holder.nextId = 20; },
  } as typeof holder & { db: typeof db; reset(): void };
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

import {
  createResponsePackage,
  getExternalPackageProjection,
  hashResponseToken,
  issueResponsePackage,
  rotateResponsePackageToken,
  reviewTradeResponse,
  submitExternalResponse,
  submitManualResponse,
  transitionResponsePackage,
} from "../packages";
import { recordInternalResponseAttachment } from "../attachments";

const actor = { id: "user-1", email: "gc@example.test" };

beforeEach(() => h.reset());

describe("response package, immutable revision, token, and GC acceptance", () => {
  test("issue requires members and stores only a token hash; package due date never changes item/consultant dates", async () => {
    h.state.items = [];
    expect((await issueResponsePackage(7, 1, { delivery: "PORTAL" }, actor)).ok).toBe(false);
    h.reset();
    const before = structuredClone(h.state.tracked[0]);
    const result = await issueResponsePackage(7, 1, { delivery: "PORTAL", contractorEmail: "trade@example.test" }, actor);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rawToken).toBeTruthy();
    expect(h.state.tokens).toHaveLength(1);
    expect(h.state.tokens[0].tokenHash).toBe(hashResponseToken(result.value.rawToken!));
    expect(JSON.stringify(h.state.tokens[0])).not.toContain(result.value.rawToken!);
    expect(h.state.tracked[0]).toEqual(before);
  });

  test("external manual issue requires and preserves a recorded delivery channel", async () => {
    expect(await issueResponsePackage(7, 1, { delivery: "MANUAL" }, actor)).toEqual({ ok: false, error: "manualChannel is required" });
    const issued = await issueResponsePackage(7, 1, { delivery: "MANUAL", manualChannel: "PROCORE" }, actor);
    expect(issued).toEqual({ ok: true, value: {} });
    expect(h.state.packages[0]).toMatchObject({ status: "ISSUED", manualChannel: "PROCORE" });
    expect(h.state.tokens).toHaveLength(0);
  });

  test("token rotation atomically revokes the old credential and returns the new raw credential once", async () => {
    const issued = await issueResponsePackage(7, 1, { delivery: "PORTAL", contractorEmail: "trade@example.test" }, actor);
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    const oldHash = hashResponseToken(issued.value.rawToken!);
    const rotated = await rotateResponsePackageToken(7, 1, { contractorEmail: "replacement@example.test" }, actor);
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    expect(h.state.tokens).toHaveLength(2);
    expect(h.state.tokens[0]).toMatchObject({ tokenHash: oldHash, revokedAt: expect.any(Date) });
    expect(h.state.tokens[1].tokenHash).toBe(hashResponseToken(rotated.value.rawToken));
    expect(JSON.stringify(h.state.tokens[1])).not.toContain(rotated.value.rawToken);
    expect(h.state.audits.some((audit) => audit.action === "response_access_token_rotate")).toBe(true);
  });

  test("invalid token expiries are rejected without entering a transaction", async () => {
    expect(await issueResponsePackage(7, 1, { delivery: "PORTAL", expiresAt: new Date("invalid") }, actor)).toEqual({ ok: false, error: "Token expiry must be within 90 days" });
    h.state.packages[0].status = "ISSUED";
    expect(await rotateResponsePackageToken(7, 1, { expiresAt: new Date("invalid") }, actor)).toEqual({ ok: false, error: "Token expiry must be within 90 days" });
  });

  test("package FSM rejects skipped transitions and permits VOIDED from DRAFT", async () => {
    expect(await transitionResponsePackage(7, 1, "GC_REVIEW", actor)).toEqual({ ok: false, error: "Invalid package transition" });
    expect(await transitionResponsePackage(7, 1, "VOIDED", actor)).toEqual({ ok: true, value: { status: "VOIDED" } });
    expect(h.state.packages[0]).toMatchObject({ status: "VOIDED", voidedAt: expect.any(Date) });
  });

  test("manual responses preserve channel/enteredBy and append immutable monotonic revisions", async () => {
    h.state.packages[0].status = "ISSUED";
    const first = await submitManualResponse(7, 1, 2, { responderName: "Trade One", channel: "EMAIL", responseType: "COMPLETED", responseText: "First exact bytes" }, actor);
    expect(first).toEqual({ ok: true, value: expect.objectContaining({ revisionIndex: 0 }) });
    const snapshot = structuredClone(h.state.responses[0]);
    const second = await submitManualResponse(7, 1, 2, { responderName: "Trade One", channel: "PROCORE", responseType: "PROPOSED_DATE", responseText: "Second revision" }, actor);
    expect(second).toEqual({ ok: true, value: expect.objectContaining({ revisionIndex: 1 }) });
    expect(h.state.responses[0]).toEqual(snapshot);
    expect(h.state.responses[0].enteredBy).toBe("gc@example.test");
    expect(h.state.responses[1].channel).toBe("PROCORE");
  });

  test("unknown, expired, revoked, and cross-package probes are identical 404 results; valid reads expose only assigned projection and stamp evidence", async () => {
    const raw = "synthetic-valid-token";
    h.state.packages[0].status = "ISSUED";
    h.state.tokens.push({ id: "token-1", bidId: 7, packageId: 1, tokenHash: hashResponseToken(raw), expiresAt: new Date(Date.now() + 60_000), revokedAt: null });
    expect(await getExternalPackageProjection("unknown")).toEqual({ ok: false, error: "Not found" });
    h.state.tokens[0].expiresAt = new Date(Date.now() - 1);
    expect(await getExternalPackageProjection(raw)).toEqual({ ok: false, error: "Not found" });
    h.state.tokens[0].expiresAt = new Date(Date.now() + 60_000); h.state.tokens[0].revokedAt = new Date();
    expect(await getExternalPackageProjection(raw)).toEqual({ ok: false, error: "Not found" });
    h.state.tokens[0].revokedAt = null;
    const valid = await getExternalPackageProjection(raw);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value).toMatchObject({ packageNumber: 1, items: [{ id: 2, trackedItem: { title: "Assigned item" } }] });
      expect(JSON.stringify(valid.value)).not.toMatch(/price|subcontractors|tokenHash/i);
    }
    expect(h.state.tokens[0].lastUsedAt).toBeInstanceOf(Date);
    expect(h.state.audits.some((audit) => audit.action === "response_access_token_read")).toBe(true);
    expect(await submitExternalResponse(raw, 999, { responderName: "Probe", responseType: "COMPLETED", responseText: "probe" })).toEqual({ ok: false, error: "Not found" });
  });

  test("GC review is separate from response bytes and gates READY_TO_TRANSMIT", async () => {
    h.state.packages[0].status = "ISSUED";
    const response = await submitManualResponse(7, 1, 2, { responderName: "Trade", channel: "EMAIL", responseType: "COMPLETED", responseText: "Contractor words" }, actor);
    expect(response.ok).toBe(true);
    expect((await transitionResponsePackage(7, 1, "RESPONSES_IN", actor)).ok).toBe(true);
    expect((await transitionResponsePackage(7, 1, "GC_REVIEW", actor)).ok).toBe(true);
    expect((await transitionResponsePackage(7, 1, "READY_TO_TRANSMIT", actor)).ok).toBe(false);
    const revisionId = Number(h.state.responses[0].id);
    const beforeText = h.state.responses[0].responseText;
    expect((await reviewTradeResponse(7, 1, 2, revisionId, { gcReview: "ACCEPTED_FOR_TRANSMITTAL", gcCommentary: "GC commentary only" }, actor)).ok).toBe(true);
    expect(h.state.responses[0].responseText).toBe(beforeText);
    expect(h.state.responses[0].gcCommentary).toBe("GC commentary only");
    expect((await transitionResponsePackage(7, 1, "READY_TO_TRANSMIT", actor)).ok).toBe(true);
  });

  test("RETURNED_FOR_REVISION produces a durable hook and blocks readiness until a newer accepted revision", async () => {
    h.state.packages[0].status = "ISSUED";
    await submitManualResponse(7, 1, 2, { responderName: "Trade", channel: "EMAIL", responseType: "COMPLETED", responseText: "Needs correction" }, actor);
    await transitionResponsePackage(7, 1, "RESPONSES_IN", actor);
    await transitionResponsePackage(7, 1, "GC_REVIEW", actor);
    const revisionId = Number(h.state.responses[0].id);
    expect((await reviewTradeResponse(7, 1, 2, revisionId, { gcReview: "RETURNED_FOR_REVISION", gcCommentary: "Correct the date" }, actor)).ok).toBe(true);
    expect(h.state.audits.some((audit) => audit.action === "trade_response_return_for_revision")).toBe(true);
    expect((await transitionResponsePackage(7, 1, "READY_TO_TRANSMIT", actor)).ok).toBe(false);
  });

  test("audit failure rolls back representative package, token, response, attachment, and GC review mutations", async () => {
    h.failAudit = true;
    const baseline = structuredClone(h.state);
    await expect(createResponsePackage(7, { title: "Rollback", contractorId: 3 }, actor)).rejects.toThrow("audit injection");
    expect(h.state).toEqual(baseline);
    await expect(issueResponsePackage(7, 1, { delivery: "PORTAL" }, actor)).rejects.toThrow("audit injection");
    expect(h.state).toEqual(baseline);
    h.failAudit = false; h.state.packages[0].status = "ISSUED";
    h.state.tokens.push({ id: "old-token", bidId: 7, packageId: 1, tokenHash: hashResponseToken("old"), expiresAt: new Date(Date.now() + 60_000), revokedAt: null });
    const beforeRotate = structuredClone(h.state);
    h.failAudit = true;
    await expect(rotateResponsePackageToken(7, 1, {}, actor)).rejects.toThrow("audit injection");
    expect(h.state).toEqual(beforeRotate);
    h.failAudit = false;
    await submitManualResponse(7, 1, 2, { responderName: "Trade", channel: "EMAIL", responseType: "COMPLETED", responseText: "base" }, actor);
    h.state.packages[0].status = "GC_REVIEW";
    const withResponse = structuredClone(h.state);
    h.failAudit = true;
    await expect(submitManualResponse(7, 1, 2, { responderName: "Trade", channel: "EMAIL", responseType: "COMPLETED", responseText: "rollback" }, actor)).rejects.toThrow("audit injection");
    expect(h.state).toEqual(withResponse);
    await expect(recordInternalResponseAttachment(7, 1, 2, Number(h.state.responses[0].id), { storageKey: "plan-room/jobs/7/response-packages/1/test.pdf", fileName: "test.pdf", mimeType: "application/pdf", byteSize: 4 }, actor)).rejects.toThrow("audit injection");
    expect(h.state).toEqual(withResponse);
    await expect(reviewTradeResponse(7, 1, 2, Number(h.state.responses[0].id), { gcReview: "RETURNED_FOR_REVISION", gcCommentary: "rollback" }, actor)).rejects.toThrow("audit injection");
    expect(h.state).toEqual(withResponse);
  });
});
