// Module OPS2 (Slice 2) — Field Report service audit atomicity (R2
// release-blocker remediation). Proves the fail-closed, in-transaction audit
// contract with the repo's mocked-Prisma idiom: a mutation and its AuditEvent
// commit together or roll back together, and a not-found/invalid request emits
// NO `committed` audit at all. No DB, no network, no provider imports.
import { beforeEach, describe, expect, test, vi } from "vitest";

// Suppress the post-commit stdout audit line — persistence still runs.
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

const h = vi.hoisted(() => ({
  reports: [] as Array<Record<string, unknown> & { id: number; bidId: number }>,
  audits: [] as Array<Record<string, unknown>>,
  nextId: 1,
}));

vi.mock("@/lib/prisma", () => {
  const p: Record<string, unknown> = {
    fieldReport: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.reports.find(
          (r) =>
            (where.id === undefined || r.id === where.id) &&
            (where.bidId === undefined || r.bidId === where.bidId)
        );
        return found ? { ...found } : null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: h.nextId++, sourceFileStorageKey: null, ...data } as unknown as (typeof h.reports)[number];
        h.reports.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = h.reports.find((r) => r.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return row;
      }),
    },
    auditEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.audits.push({ ...data });
        return { id: h.nextId++ };
      }),
    },
  };
  p.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
    const snap = {
      reports: h.reports.map((r) => ({ ...r })),
      audits: h.audits.map((r) => ({ ...r })),
    };
    try {
      return await fn(p);
    } catch (err) {
      h.reports.splice(0, h.reports.length, ...snap.reports);
      h.audits.splice(0, h.audits.length, ...snap.audits);
      throw err;
    }
  };
  return { prisma: p };
});

import { createFieldReport, recordReportFile, updateFieldReport } from "../index";

const ACTOR = { id: "user-1", email: "josh@example.test" };

async function breakAudit(run: () => Promise<unknown>) {
  const prisma = (await import("@/lib/prisma")).prisma as unknown as {
    auditEvent: { create: (a: unknown) => Promise<unknown> };
  };
  const real = prisma.auditEvent.create;
  prisma.auditEvent.create = async () => {
    throw new Error("audit store down");
  };
  try {
    return await run();
  } finally {
    prisma.auditEvent.create = real;
  }
}

const seedReport = (over: Record<string, unknown> = {}) => {
  const row = { id: h.nextId++, bidId: 5, title: "Daily", sourceFileStorageKey: null, ...over } as (typeof h.reports)[number];
  h.reports.push(row);
  return row;
};

beforeEach(() => {
  h.reports.length = 0;
  h.audits.length = 0;
  h.nextId = 1;
});

describe("fieldReports audit atomicity", () => {
  test("create: mutation + audit commit together", async () => {
    const r = await createFieldReport(5, { title: "Daily 07/09" }, ACTOR);
    expect(r.ok).toBe(true);
    expect(h.reports.length).toBe(1);
    expect(
      h.audits.some(
        (a) => a.action === "field_report_create" && a.subjectKind === "FieldReport" && a.decision === "committed"
      )
    ).toBe(true);
  });

  test("create: empty title makes no mutation and no audit", async () => {
    const r = await createFieldReport(5, { title: "   " }, ACTOR);
    expect(r.ok).toBe(false);
    expect(h.reports.length).toBe(0);
    expect(h.audits.length).toBe(0);
  });

  test("create: an audit-store failure rolls the whole create back (fail-closed)", async () => {
    await expect(breakAudit(() => createFieldReport(5, { title: "letter" }, ACTOR))).rejects.toThrow(
      "audit store down"
    );
    expect(h.reports.length).toBe(0);
    expect(h.audits.length).toBe(0);
  });

  test("update: not-found and invalid requests emit NO committed audit", async () => {
    seedReport(); // id 1, bid 5
    // not found in this bid
    expect((await updateFieldReport(5, 999, { title: "ghost" }, ACTOR)).ok).toBe(false);
    // cross-bid
    expect((await updateFieldReport(9, 1, { title: "x" }, ACTOR)).ok).toBe(false);
    // invalid title on an existing report
    expect((await updateFieldReport(5, 1, { title: "  " }, ACTOR)).ok).toBe(false);
    expect(h.audits.length).toBe(0);
    expect(h.reports[0].title).toBe("Daily");
  });

  test("update: an audit-store failure rolls the mutation back", async () => {
    seedReport();
    await expect(
      breakAudit(() => updateFieldReport(5, 1, { title: "Revised" }, ACTOR))
    ).rejects.toThrow("audit store down");
    expect(h.reports[0].title).toBe("Daily"); // unchanged
    expect(h.audits.length).toBe(0);
  });

  test("recordReportFile: not-found makes no audit; success audits and reports superseded key", async () => {
    // not found → no audit, no mutation
    const missing = await recordReportFile(
      5,
      999,
      { storageKey: "k/a.pdf", fileName: "a.pdf", mimeType: "application/pdf", byteSize: 3 },
      ACTOR
    );
    expect(missing.ok).toBe(false);
    expect(h.audits.length).toBe(0);

    // first upload
    seedReport(); // id 1
    const first = await recordReportFile(
      5,
      1,
      { storageKey: "k/a.pdf", fileName: "a.pdf", mimeType: "application/pdf", byteSize: 3 },
      ACTOR
    );
    expect(first.ok && first.value.previousStorageKey).toBeNull();
    // re-upload under a different key reports the previous one for cleanup
    const second = await recordReportFile(
      5,
      1,
      { storageKey: "k/b.pdf", fileName: "b.pdf", mimeType: "application/pdf", byteSize: 4 },
      ACTOR
    );
    expect(second.ok && second.value.previousStorageKey).toBe("k/a.pdf");
    expect(h.reports[0].sourceFileStorageKey).toBe("k/b.pdf");
    expect(h.audits.filter((a) => a.action === "field_report_file_recorded").length).toBe(2);
  });

  test("recordReportFile: an audit-store failure rolls the metadata write back", async () => {
    seedReport({ sourceFileStorageKey: "k/old.pdf" });
    await expect(
      breakAudit(() =>
        recordReportFile(
          5,
          1,
          { storageKey: "k/new.pdf", fileName: "new.pdf", mimeType: "application/pdf", byteSize: 5 },
          ACTOR
        )
      )
    ).rejects.toThrow("audit store down");
    // metadata pointer unchanged — the blob route will compensate the new blob
    expect(h.reports[0].sourceFileStorageKey).toBe("k/old.pdf");
    expect(h.audits.length).toBe(0);
  });
});
