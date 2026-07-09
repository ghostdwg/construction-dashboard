// Module OPS2 (Slice 2) — Field Report routes + spine integration coverage.
// Mocked Prisma/auth/audit/BlobStore per repo idiom: no DB, no network, no
// provider or Procore import anywhere on these paths.
import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  reports: [] as Array<Record<string, unknown> & { id: number; bidId: number }>,
  items: [] as Array<Record<string, unknown> & { id: number; bidId: number }>,
  bidExists: true,
  nextId: 1,
}));

const putMock = vi.hoisted(() => vi.fn(async () => ({ key: "x" })));
const deleteMock = vi.hoisted(() => vi.fn(async () => undefined));
const auditMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: auditMock }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.test" } })),
}));
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ put: putMock, delete: deleteMock }),
  safeBlobFileName: (name: string) => {
    const base = name.split("/").pop()!.trim();
    return base.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180) || "upload.bin";
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bid: { findUnique: vi.fn(async () => (h.bidExists ? { id: 1 } : null)) },
    fieldReport: {
      findMany: vi.fn(async ({ where }: { where: { bidId: number } }) =>
        h.reports
          .filter((r) => r.bidId === where.bidId)
          .map((r) => ({ ...r, _count: { trackedItems: h.items.filter((i) => i.sourceFieldReportId === r.id).length } }))
      ),
      findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) => {
        const found = h.reports.find((r) => r.id === where.id && r.bidId === where.bidId);
        if (!found) return null;
        return {
          ...found,
          trackedItems: h.items
            .filter((i) => i.sourceFieldReportId === found.id)
            .map((i) => ({ id: i.id, title: i.title, status: i.status, kind: i.kind })),
        };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: h.nextId++,
          sourceFileStorageKey: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
          ...data,
        } as unknown as (typeof h.reports)[number];
        h.reports.push(row);
        return { id: row.id };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const row = h.reports.find((r) => r.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    trackedItem: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: h.nextId++,
          status: "OPEN",
          createdAt: new Date(0),
          ...data,
        } as unknown as (typeof h.items)[number];
        h.items.push(row);
        return { id: row.id };
      }),
    },
  },
}));

import { GET as listGET, POST as createPOST } from "../route";
import { GET as detailGET, PATCH as detailPATCH } from "../[fieldReportId]/route";
import { POST as uploadPOST } from "../[fieldReportId]/upload/route";
import { POST as itemPOST } from "../[fieldReportId]/tracked-items/route";

const p = (id: string) => ({ params: Promise.resolve({ id }) });
const pr = (id: string, fieldReportId: string) => ({
  params: Promise.resolve({ id, fieldReportId }),
});
const jsonReq = (body: unknown) =>
  new Request("http://test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const fileReq = (name: string, type: string, bytes = 3) => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], name, { type }));
  return new Request("http://t", { method: "POST", body: form });
};

beforeEach(() => {
  h.reports.length = 0;
  h.items.length = 0;
  h.bidExists = true;
  h.nextId = 1;
  putMock.mockClear();
  deleteMock.mockClear();
  auditMock.mockClear();
});

describe("field-reports routes", () => {
  test("create/list: bid-scoped; 404 on missing bid; 400 on empty title", async () => {
    expect((await createPOST(jsonReq({ title: "Daily 07/09" }), p("5"))).status).toBe(201);
    expect((await createPOST(jsonReq({ title: "Other bid" }), p("6"))).status).toBe(201);
    expect((await createPOST(jsonReq({ title: "  " }), p("5"))).status).toBe(400);
    h.bidExists = false;
    expect((await createPOST(jsonReq({ title: "x" }), p("9"))).status).toBe(404);
    h.bidExists = true;

    const list = await listGET(new Request("http://t"), p("5"));
    const json = await list.json();
    expect(json.fieldReports.length).toBe(1);
    expect(json.fieldReports[0].title).toBe("Daily 07/09");
    expect(json.fieldReports[0].parseStatus).toBe("UNPARSED");
  });

  test("detail GET + PATCH are tenancy-scoped", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));
    expect((await detailGET(new Request("http://t"), pr("5", "1"))).status).toBe(200);
    expect((await detailGET(new Request("http://t"), pr("6", "1"))).status).toBe(404);
    expect((await detailPATCH(jsonReq({ title: "Daily r2" }), pr("5", "1"))).status).toBe(200);
    expect((await detailPATCH(jsonReq({ title: "nope" }), pr("6", "1"))).status).toBe(404);
    expect(h.reports[0].title).toBe("Daily r2");
  });

  test("upload: MIME allowlist + size gate; canonical storage key; tenancy before bytes", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));

    expect((await uploadPOST(fileReq("x.zip", "application/zip"), pr("5", "1"))).status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();

    expect((await uploadPOST(fileReq("a.pdf", "application/pdf"), pr("6", "1"))).status).toBe(404);
    expect(putMock).not.toHaveBeenCalled(); // tenancy enforced BEFORE any byte

    const ok = await uploadPOST(fileReq("daily report.pdf", "application/pdf"), pr("5", "1"));
    expect(ok.status).toBe(201);
    expect((putMock.mock.calls[0] as unknown[])[0]).toBe(
      "plan-room/jobs/5/field-reports/1/daily report.pdf"
    );
    expect(h.reports[0].sourceFileStorageKey).toBe(
      "plan-room/jobs/5/field-reports/1/daily report.pdf"
    );
    expect(h.reports[0].parseStatus).toBe("UNPARSED"); // upload never advances parse state
  });

  test("upload ordering: blob failure leaves metadata untouched; metadata failure cleans blob; re-upload cleans superseded blob", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));

    putMock.mockRejectedValueOnce(new Error("disk full (simulated)"));
    const blobFail = await uploadPOST(fileReq("a.pdf", "application/pdf"), pr("5", "1"));
    expect(blobFail.status).toBe(500);
    expect(h.reports[0].sourceFileStorageKey).toBeNull();
    expect(deleteMock).not.toHaveBeenCalled();

    const prismaModule = await import("@/lib/prisma");
    const update = prismaModule.prisma.fieldReport.update as ReturnType<typeof vi.fn>;
    update.mockRejectedValueOnce(new Error("db write failed (simulated)"));
    const metaFail = await uploadPOST(fileReq("b.pdf", "application/pdf"), pr("5", "1"));
    expect(metaFail.status).toBe(500);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect((deleteMock.mock.calls[0] as unknown[])[0]).toBe(
      "plan-room/jobs/5/field-reports/1/b.pdf"
    );
    expect(h.reports[0].sourceFileStorageKey).toBeNull();

    deleteMock.mockClear();
    expect((await uploadPOST(fileReq("c.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    expect((await uploadPOST(fileReq("d.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    // superseded c.pdf blob cleaned up after successful d.pdf metadata write
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect((deleteMock.mock.calls[0] as unknown[])[0]).toBe(
      "plan-room/jobs/5/field-reports/1/c.pdf"
    );
  });

  test("create TrackedItem from report: FIELD_ITEM on the spine with citation; cross-bid refused; audited", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));

    const ok = await itemPOST(
      jsonReq({
        title: "Curb cracked at NE corner",
        evidenceExcerpt: "photo 3 shows spall at grid B/2",
        sourceLocator: "p.2",
      }),
      pr("5", "1")
    );
    expect(ok.status).toBe(201);
    const item = h.items[0];
    expect(item.kind).toBe("FIELD_ITEM");
    expect(item.sourceKind).toBe("field_report");
    expect(item.sourceFieldReportId).toBe(1);
    expect(item.extractionMethod).toBe("manual");
    expect(item.citationVerified).toBe(false);
    expect(item.evidenceExcerpt).toBe("photo 3 shows spall at grid B/2");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "created_from_field_report" })
    );

    // cross-bid: report 1 belongs to bid 5 — bid 6 cannot create items from it
    const crossBid = await itemPOST(jsonReq({ title: "nope" }), pr("6", "1"));
    expect(crossBid.status).toBe(404);
    expect(h.items.length).toBe(1);

    const noTitle = await itemPOST(jsonReq({ title: "  " }), pr("5", "1"));
    expect(noTitle.status).toBe(400);
  });
});
