// Module OPS3 (Phase 1A) — route coverage for consultant-report upload,
// listing, duplicate handling, corrected revisions, and role-gated void.
// Mocked Prisma/auth/audit/BlobStore per the repo idiom — no DB, no
// network, no provider import anywhere on these paths.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  bids: new Set<number>([1, 2]),
  reports: [] as Row[],
  revisions: [] as Row[],
  observations: [] as Row[],
  blobs: new Map<string, Buffer>(),
  audits: [] as Array<{ action: string; payload: Record<string, unknown> | undefined }>,
  currentUser: { id: "u1", role: "admin" } as { id: string; role: string } | null,
  nextId: 1,
}));

const auditMock = vi.hoisted(() =>
  vi.fn(async (input: { action: string; payload?: Record<string, unknown> }) => {
    h.audits.push({ action: input.action, payload: input.payload });
  })
);

vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: auditMock }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.test" } })),
}));
vi.mock("@/lib/auth-helpers", () => ({
  ROLES: { ADMIN: "admin", ESTIMATOR: "estimator", PM: "pm" },
  getUser: vi.fn(async () => h.currentUser),
}));
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({
    put: vi.fn(async (key: string, buf: Buffer) => {
      h.blobs.set(key, buf);
      return { key };
    }),
    get: vi.fn(async (key: string) => {
      const buf = h.blobs.get(key);
      if (!buf) throw new Error("missing blob");
      return buf;
    }),
    delete: vi.fn(async () => undefined),
  }),
}));

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

vi.mock("@/lib/prisma", () => {
  const prisma = {
    bid: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
        h.bids.has(where.id) ? { id: where.id } : null
      ),
    },
    consultantReport: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.reports.find((r) => matches(r, where));
        return found ? { ...found } : null;
      }),
      findMany: vi.fn(async ({ where }: { where: { bidId: number } }) =>
        h.reports
          .filter((r) => r.bidId === where.bidId)
          .map((r) => ({
            ...r,
            revisions: h.revisions
              .filter((rev) => rev.reportId === r.id)
              .sort((a, b) => (b.revisionIndex as number) - (a.revisionIndex as number)),
            _count: {
              observations: h.observations.filter((o) => o.reportId === r.id).length,
            },
          }))
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: h.nextId++,
          status: "ACTIVE",
          uploadedAt: new Date(0),
          createdAt: new Date(0),
          updatedAt: new Date(0),
          reportDate: null,
          title: null,
          reportNumber: null,
          reportNumberNormalized: null,
          voidedBy: null,
          voidedAt: null,
          ...data,
        } as Row;
        h.reports.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = h.reports.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
    },
    consultantReportRevision: {
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown>; orderBy?: unknown }) => {
          const sorted = [...h.revisions].sort(
            (a, b) => (b.revisionIndex as number) - (a.revisionIndex as number)
          );
          const found = sorted.find((r) => matches(r, where));
          return found ? { ...found } : null;
        }
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: h.nextId++,
          uploadedAt: new Date(0),
          replacementReason: null,
          supersedesRevisionId: null,
          ...data,
        } as Row;
        h.revisions.push(row);
        return { id: row.id };
      }),
    },
    consultantObservation: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  return { prisma };
});

import { GET as listGET, POST as uploadPOST } from "../route";
import { POST as revisionsPOST } from "../[reportId]/revisions/route";
import { POST as voidPOST } from "../[reportId]/void/route";

const p = (id: string) => ({ params: Promise.resolve({ id }) });
const pr = (id: string, reportId: string) => ({
  params: Promise.resolve({ id, reportId }),
});

const PDF_BYTES = `%PDF-1.7\nsome consultant report body`;

function uploadReq(
  fields: Record<string, string>,
  file: { name: string; content: string | Buffer; type: string } | null
) {
  const form = new FormData();
  if (file) {
    form.append(
      "file",
      new File([typeof file.content === "string" ? file.content : new Uint8Array(file.content)], file.name, {
        type: file.type,
      })
    );
  }
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return new Request("http://test/x", { method: "POST", body: form });
}

const baseFields = { vendorName: "IMEG", reportType: "ENGINEER_FIELD_REPORT" };

beforeEach(() => {
  h.reports.length = 0;
  h.revisions.length = 0;
  h.observations.length = 0;
  h.blobs.clear();
  h.audits.length = 0;
  h.currentUser = { id: "u1", role: "admin" };
  h.nextId = 1;
  auditMock.mockClear();
});

describe("POST /consultant-reports (upload)", () => {
  test("valid PDF creates report + revision 0 + audit, content-addressed blob", async () => {
    const res = await uploadPOST(
      uploadReq(baseFields, { name: "JSO-14.pdf", content: PDF_BYTES, type: "application/pdf" }),
      p("1")
    );
    expect(res.status).toBe(201);
    const json = (await res.json()) as { reportId: number; duplicate: boolean };
    expect(json.duplicate).toBe(false);
    expect(h.reports).toHaveLength(1);
    expect(h.revisions).toHaveLength(1);
    expect(h.revisions[0].revisionIndex).toBe(0);
    expect(h.revisions[0].reportId).toBe(json.reportId);
    const key = h.revisions[0].storedKey as string;
    expect(key).toMatch(/^plan-room\/jobs\/1\/consultant-reports\/[0-9a-f]{64}\.pdf$/);
    expect(h.blobs.has(key)).toBe(true);
    expect(h.audits.map((a) => a.action)).toContain("report_uploaded");
  });

  test("exact duplicate returns the existing report — zero new rows, duplicate audit", async () => {
    const file = { name: "JSO-14.pdf", content: PDF_BYTES, type: "application/pdf" };
    await uploadPOST(uploadReq(baseFields, file), p("1"));
    const res = await uploadPOST(uploadReq(baseFields, file), p("1"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { duplicate: boolean; reportId: number };
    expect(json.duplicate).toBe(true);
    expect(json.reportId).toBe(h.reports[0].id);
    expect(h.reports).toHaveLength(1);
    expect(h.revisions).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).toContain("report_duplicate_detected");
  });

  test("renamed duplicate (same bytes, new filename) is still a duplicate", async () => {
    await uploadPOST(
      uploadReq(baseFields, { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" }),
      p("1")
    );
    const res = await uploadPOST(
      uploadReq(baseFields, { name: "renamed.pdf", content: PDF_BYTES, type: "application/pdf" }),
      p("1")
    );
    expect(((await res.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(h.reports).toHaveLength(1);
  });

  test("identical file in a SECOND project is allowed — distinct rows", async () => {
    const file = { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" };
    await uploadPOST(uploadReq(baseFields, file), p("1"));
    const res = await uploadPOST(uploadReq(baseFields, file), p("2"));
    expect(res.status).toBe(201);
    expect(h.reports).toHaveLength(2);
    expect(h.revisions).toHaveLength(2);
  });

  test("wrong MIME type → 400, nothing stored", async () => {
    const res = await uploadPOST(
      uploadReq(baseFields, { name: "a.png", content: PDF_BYTES, type: "image/png" }),
      p("1")
    );
    expect(res.status).toBe(400);
    expect(h.reports).toHaveLength(0);
    expect(h.blobs.size).toBe(0);
  });

  test("correct MIME + WRONG magic bytes → 400 (the Codex-mandated check)", async () => {
    const res = await uploadPOST(
      uploadReq(baseFields, {
        name: "fake.pdf",
        content: "<html>not a pdf</html>",
        type: "application/pdf",
      }),
      p("1")
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/%PDF-/);
    expect(h.reports).toHaveLength(0);
    expect(h.blobs.size).toBe(0);
  });

  test("oversized upload (>25 MiB) → 400 before any store", async () => {
    const big = Buffer.alloc(25 * 1024 * 1024 + 1, 0x20);
    big.write("%PDF-", 0, "ascii");
    const res = await uploadPOST(
      uploadReq(baseFields, { name: "big.pdf", content: big, type: "application/pdf" }),
      p("1")
    );
    expect(res.status).toBe(400);
    expect(h.blobs.size).toBe(0);
  });

  test("missing vendorName / reportType / file → 400", async () => {
    const file = { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" };
    expect(
      (await uploadPOST(uploadReq({ reportType: "ENGINEER_FIELD_REPORT" }, file), p("1"))).status
    ).toBe(400);
    expect((await uploadPOST(uploadReq({ vendorName: "IMEG" }, file), p("1"))).status).toBe(400);
    expect((await uploadPOST(uploadReq(baseFields, null), p("1"))).status).toBe(400);
  });

  test("unknown reportType → 400", async () => {
    const res = await uploadPOST(
      uploadReq(
        { vendorName: "IMEG", reportType: "NOT_A_TYPE" },
        { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" }
      ),
      p("1")
    );
    expect(res.status).toBe(400);
  });

  test("nonexistent bid → 404, blob never written", async () => {
    const res = await uploadPOST(
      uploadReq(baseFields, { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" }),
      p("999")
    );
    expect(res.status).toBe(404);
    expect(h.blobs.size).toBe(0);
  });
});

describe("GET /consultant-reports (list)", () => {
  test("returns rows with revision + observation rollup", async () => {
    await uploadPOST(
      uploadReq(baseFields, { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" }),
      p("1")
    );
    const res = await listGET(new Request("http://test/x"), p("1"));
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      consultantReports: Array<{ vendorName: string; revisionCount: number; observationCount: number }>;
    };
    expect(json.consultantReports).toHaveLength(1);
    expect(json.consultantReports[0].vendorName).toBe("IMEG");
    expect(json.consultantReports[0].revisionCount).toBe(1);
    expect(json.consultantReports[0].observationCount).toBe(0);
  });

  test("scoped by bid — the other bid's list is empty", async () => {
    await uploadPOST(
      uploadReq(baseFields, { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" }),
      p("1")
    );
    const res = await listGET(new Request("http://test/x"), p("2"));
    const json = (await res.json()) as { consultantReports: unknown[] };
    expect(json.consultantReports).toHaveLength(0);
  });
});

describe("POST /consultant-reports/[reportId]/revisions (corrected file)", () => {
  async function seedReport(): Promise<number> {
    const res = await uploadPOST(
      uploadReq(baseFields, { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" }),
      p("1")
    );
    return ((await res.json()) as { reportId: number }).reportId;
  }

  test("corrected file → new revision, supersedesRevisionId set, both retained", async () => {
    const reportId = await seedReport();
    const firstRevisionId = h.revisions[0].id;
    const res = await revisionsPOST(
      uploadReq(
        { replacementReason: "structural pages corrected" },
        { name: "a-r1.pdf", content: `${PDF_BYTES} corrected`, type: "application/pdf" }
      ),
      pr("1", String(reportId))
    );
    expect(res.status).toBe(201);
    expect(h.revisions).toHaveLength(2);
    const r1 = h.revisions[1];
    expect(r1.revisionIndex).toBe(1);
    expect(r1.supersedesRevisionId).toBe(firstRevisionId);
    expect(h.blobs.size).toBe(2); // both files retained
    expect(h.audits.map((a) => a.action)).toContain("revision_superseded");
  });

  test("re-uploading the SAME bytes as a revision is a duplicate — no new row", async () => {
    const reportId = await seedReport();
    const res = await revisionsPOST(
      uploadReq({}, { name: "same.pdf", content: PDF_BYTES, type: "application/pdf" }),
      pr("1", String(reportId))
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(h.revisions).toHaveLength(1);
  });

  test("cross-project revision upload → 404, zero mutation", async () => {
    const reportId = await seedReport();
    const res = await revisionsPOST(
      uploadReq({}, { name: "x.pdf", content: `${PDF_BYTES} v2`, type: "application/pdf" }),
      pr("2", String(reportId))
    );
    expect(res.status).toBe(404);
    expect(h.revisions).toHaveLength(1);
  });

  test("magic-byte gate applies to revisions too", async () => {
    const reportId = await seedReport();
    const res = await revisionsPOST(
      uploadReq({}, { name: "x.pdf", content: "not a pdf", type: "application/pdf" }),
      pr("1", String(reportId))
    );
    expect(res.status).toBe(400);
    expect(h.revisions).toHaveLength(1);
  });

  test("voided report refuses corrected files", async () => {
    const reportId = await seedReport();
    await voidPOST(new Request("http://test/x", { method: "POST" }), pr("1", String(reportId)));
    const res = await revisionsPOST(
      uploadReq({}, { name: "x.pdf", content: `${PDF_BYTES} v2`, type: "application/pdf" }),
      pr("1", String(reportId))
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /consultant-reports/[reportId]/void (role-gated)", () => {
  async function seedReport(): Promise<number> {
    const res = await uploadPOST(
      uploadReq(baseFields, { name: "a.pdf", content: PDF_BYTES, type: "application/pdf" }),
      p("1")
    );
    return ((await res.json()) as { reportId: number }).reportId;
  }

  test("admin can void — status flip, actor recorded, file retained", async () => {
    const reportId = await seedReport();
    const res = await voidPOST(new Request("http://test/x", { method: "POST" }), pr("1", String(reportId)));
    expect(res.status).toBe(200);
    const row = h.reports.find((r) => r.id === reportId)!;
    expect(row.status).toBe("VOIDED");
    expect(row.voidedBy).toBe("josh@example.test");
    expect(h.blobs.size).toBe(1); // nothing deleted
    expect(h.audits.map((a) => a.action)).toContain("report_voided");
  });

  test("pm can void", async () => {
    const reportId = await seedReport();
    h.currentUser = { id: "u2", role: "pm" };
    const res = await voidPOST(new Request("http://test/x", { method: "POST" }), pr("1", String(reportId)));
    expect(res.status).toBe(200);
  });

  test("estimator → 403, zero mutation", async () => {
    const reportId = await seedReport();
    h.currentUser = { id: "u3", role: "estimator" };
    const res = await voidPOST(new Request("http://test/x", { method: "POST" }), pr("1", String(reportId)));
    expect(res.status).toBe(403);
    expect(h.reports.find((r) => r.id === reportId)!.status).toBe("ACTIVE");
  });

  test("unauthenticated → 401", async () => {
    const reportId = await seedReport();
    h.currentUser = null;
    const res = await voidPOST(new Request("http://test/x", { method: "POST" }), pr("1", String(reportId)));
    expect(res.status).toBe(401);
  });

  test("cross-project void → 404", async () => {
    const reportId = await seedReport();
    const res = await voidPOST(new Request("http://test/x", { method: "POST" }), pr("2", String(reportId)));
    expect(res.status).toBe(404);
    expect(h.reports.find((r) => r.id === reportId)!.status).toBe("ACTIVE");
  });

  test("double void → 400", async () => {
    const reportId = await seedReport();
    await voidPOST(new Request("http://test/x", { method: "POST" }), pr("1", String(reportId)));
    const res = await voidPOST(new Request("http://test/x", { method: "POST" }), pr("1", String(reportId)));
    expect(res.status).toBe(400);
  });
});
