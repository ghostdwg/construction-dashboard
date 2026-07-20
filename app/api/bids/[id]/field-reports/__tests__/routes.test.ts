// Module OPS2 (Slice 2) — Field Report routes + spine integration coverage.
// Mocked Prisma/auth/audit/BlobStore per repo idiom: no DB, no network, no
// provider or Procore import anywhere on these paths.
import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  reports: [] as Array<Record<string, unknown> & { id: number; bidId: number }>,
  items: [] as Array<Record<string, unknown> & { id: number; bidId: number }>,
  observations: [] as Array<{
    id: number;
    bidId: number;
    fieldReportId: number;
    disposition: string;
    registerItemId?: number | null;
    sourceLocator?: string | null;
  }>,
  bidExists: true,
  nextId: 1,
  auditFail: false,
}));

const putMock = vi.hoisted(() => vi.fn(async () => ({ key: "x" })));
const deleteMock = vi.hoisted(() => vi.fn(async () => undefined));
const getMock = vi.hoisted(() => vi.fn(async () => Buffer.from("retained historical evidence")));
const auditMock = vi.hoisted(() =>
  vi.fn(async (_input: Record<string, unknown>) => undefined),
);
const accessMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock("@/lib/services/operationsAudit", () => ({
  writeOperationsAuditTx: vi.fn(async (_tx, args) => {
    if (h.auditFail) throw new Error("synthetic audit failure");
    await auditMock({ category: "register_action", ...args });
    return args;
  }),
  emitOperationsAuditPostCommit: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.test" } })),
}));
vi.mock("@/lib/auth-helpers", () => ({ requireBidAccess: accessMock }));
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ put: putMock, get: getMock, delete: deleteMock }),
  safeBlobFileName: (name: string) => {
    const base = name.split("/").pop()!.trim();
    return base.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180) || "upload.bin";
  },
}));

vi.mock("@/lib/prisma", () => {
  const prisma = {
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
        const trackedItems = h.items.filter((i) => i.sourceFieldReportId === found.id);
        const observations = h.observations.filter((o) => o.fieldReportId === found.id);
        return {
          ...found,
          trackedItems: trackedItems.map((i) => ({ id: i.id, title: i.title, status: i.status, kind: i.kind })),
          _count: { trackedItems: trackedItems.length, observations: observations.length },
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
      updateMany: vi.fn(async ({ where, data }: {
        where: { id: number; bidId: number; sourceFileStorageKey: string | null };
        data: Record<string, unknown>;
      }) => {
        const row = h.reports.find((r) =>
          r.id === where.id &&
          r.bidId === where.bidId &&
          r.sourceFileStorageKey === where.sourceFileStorageKey
        );
        if (!row) return { count: 0 };
        if (h.items.some((i) => i.sourceFieldReportId === row.id)) return { count: 0 };
        if (h.observations.some((o) => o.fieldReportId === row.id)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
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
  } as Record<string, unknown>;
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
    const snapshot = {
      reports: structuredClone(h.reports),
      items: structuredClone(h.items),
      observations: structuredClone(h.observations),
      nextId: h.nextId,
    };
    try {
      return await fn(prisma);
    } catch (error) {
      h.reports.splice(0, h.reports.length, ...snapshot.reports);
      h.items.splice(0, h.items.length, ...snapshot.items);
      h.observations.splice(0, h.observations.length, ...snapshot.observations);
      h.nextId = snapshot.nextId;
      throw error;
    }
  });
  return { prisma };
});

import { GET as listGET, POST as createPOST } from "../route";
import { GET as detailGET, PATCH as detailPATCH } from "../[fieldReportId]/route";
import { POST as uploadPOST } from "../[fieldReportId]/upload/route";
import { GET as downloadGET } from "../[fieldReportId]/download/route";
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
  h.observations.length = 0;
  h.bidExists = true;
  h.nextId = 1;
  h.auditFail = false;
  putMock.mockClear();
  deleteMock.mockClear();
  getMock.mockClear();
  getMock.mockResolvedValue(Buffer.from("retained historical evidence"));
  auditMock.mockClear();
  accessMock.mockReset();
  accessMock.mockResolvedValue({ ok: true, user: { id: "user-1" } });
});

describe("field-reports routes", () => {
  test("authorization denial happens before body parsing, database, and blob writes", async () => {
    const denied = Response.json({ error: "Not found" }, { status: 404 });
    accessMock.mockResolvedValueOnce({ ok: false, response: denied });
    const request = { formData: vi.fn() } as unknown as Request;
    const response = await uploadPOST(request, pr("6", "1"));
    expect(response.status).toBe(404);
    expect(request.formData).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(h.reports).toHaveLength(0);
  });
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

  test("audit failure rolls back create/update and invalid/not-found requests write no audit", async () => {
    h.auditFail = true;
    await expect(createPOST(jsonReq({ title: "Confidential daily" }), p("5")))
      .rejects.toThrow("synthetic audit failure");
    expect(h.reports).toEqual([]);
    expect(auditMock).not.toHaveBeenCalled();

    h.auditFail = false;
    expect((await createPOST(jsonReq({ title: "Seed" }), p("5"))).status).toBe(201);
    const before = structuredClone(h.reports);
    const auditCount = auditMock.mock.calls.length;
    h.auditFail = true;
    await expect(detailPATCH(jsonReq({ title: "Confidential revised" }), pr("5", "1")))
      .rejects.toThrow("synthetic audit failure");
    expect(h.reports).toEqual(before);
    expect(auditMock).toHaveBeenCalledTimes(auditCount);

    h.auditFail = false;
    expect((await detailPATCH(jsonReq({ title: "  " }), pr("5", "1"))).status).toBe(400);
    expect((await detailPATCH(jsonReq({ title: "x" }), pr("6", "1"))).status).toBe(404);
    expect(auditMock).toHaveBeenCalledTimes(auditCount);
  });

  test("upload: MIME allowlist + size gate; canonical storage key; tenancy before bytes", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));

    expect((await uploadPOST(fileReq("x.zip", "application/zip"), pr("5", "1"))).status).toBe(400);
    expect(putMock).not.toHaveBeenCalled();

    expect((await uploadPOST(fileReq("a.pdf", "application/pdf"), pr("6", "1"))).status).toBe(404);
    expect(putMock).not.toHaveBeenCalled(); // tenancy enforced BEFORE any byte

    const ok = await uploadPOST(fileReq("daily report.pdf", "application/pdf"), pr("5", "1"));
    expect(ok.status).toBe(201);
    const key = (putMock.mock.calls[0] as unknown[])[0] as string;
    expect(key).toMatch(/^plan-room\/jobs\/5\/field-reports\/1\/[a-f0-9-]{36}\/daily report\.pdf$/);
    expect(h.reports[0].sourceFileStorageKey).toBe(key);
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
    const updateMany = prismaModule.prisma.fieldReport.updateMany as ReturnType<typeof vi.fn>;
    updateMany.mockRejectedValueOnce(new Error("db write failed (simulated)"));
    const metaFail = await uploadPOST(fileReq("b.pdf", "application/pdf"), pr("5", "1"));
    expect(metaFail.status).toBe(500);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    const failedMetadataKey = (putMock.mock.calls[1] as unknown[])[0];
    expect((deleteMock.mock.calls[0] as unknown[])[0]).toBe(failedMetadataKey);
    expect(h.reports[0].sourceFileStorageKey).toBeNull();

    deleteMock.mockClear();
    expect((await uploadPOST(fileReq("c.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    const cKey = (putMock.mock.calls[2] as unknown[])[0];
    expect((await uploadPOST(fileReq("d.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    // superseded c.pdf blob cleaned up after successful d.pdf metadata write
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect((deleteMock.mock.calls[0] as unknown[])[0]).toBe(cKey);
  });

  test("file-record audit failure restores prior metadata and deletes only the new immutable blob", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));
    expect((await uploadPOST(fileReq("same.pdf", "application/pdf", 2), pr("5", "1"))).status).toBe(201);
    const priorKey = h.reports[0].sourceFileStorageKey;
    h.auditFail = true;
    const response = await uploadPOST(fileReq("same.pdf", "application/pdf", 3), pr("5", "1"));
    expect(response.status).toBe(500);
    expect(h.reports[0].sourceFileStorageKey).toBe(priorKey);
    const newKey = (putMock.mock.calls.at(-1) as unknown[])[0];
    expect(newKey).not.toBe(priorKey);
    expect((deleteMock.mock.calls.at(-1) as unknown[])[0]).toBe(newKey);
  });

  test("concurrent pre-reference re-uploads compare-and-swap; the loser compensates only its new blob", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));
    expect((await uploadPOST(fileReq("original.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    const originalKey = h.reports[0].sourceFileStorageKey;
    putMock.mockClear();
    deleteMock.mockClear();
    auditMock.mockClear();

    const responses = await Promise.all([
      uploadPOST(fileReq("revision-a.pdf", "application/pdf", 4), pr("5", "1")),
      uploadPOST(fileReq("revision-b.pdf", "application/pdf", 5), pr("5", "1")),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const newKeys = putMock.mock.calls.map((call) => (call as unknown[])[0] as string);
    const winningKey = h.reports[0].sourceFileStorageKey as string;
    const losingKey = newKeys.find((key) => key !== winningKey);
    expect(newKeys).toContain(winningKey);
    expect(losingKey).toBeTruthy();
    const deletedKeys = deleteMock.mock.calls.map((call) => (call as unknown[])[0]);
    expect(deletedKeys).toEqual(expect.arrayContaining([originalKey, losingKey]));
    expect(deletedKeys).not.toContain(winningKey);
    expect(auditMock).toHaveBeenCalledTimes(1);
  });

  test("an observation that wins after preflight retains cited bytes and compensates only the replacement blob", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));
    expect((await uploadPOST(fileReq("original.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    const citedKey = h.reports[0].sourceFileStorageKey;
    putMock.mockClear();
    deleteMock.mockClear();
    auditMock.mockClear();
    putMock.mockImplementationOnce(async () => {
      h.observations.push({
        id: 89,
        bidId: 5,
        fieldReportId: 1,
        disposition: "OPEN",
        sourceLocator: "p.1/photo 2",
      });
      return { key: "replacement" };
    });

    const response = await uploadPOST(fileReq("replacement.pdf", "application/pdf"), pr("5", "1"));
    expect(response.status).toBe(409);
    const replacementKey = (putMock.mock.calls[0] as unknown[])[0];
    expect(h.reports[0].sourceFileStorageKey).toBe(citedKey);
    expect(deleteMock).toHaveBeenCalledTimes(1);
    expect((deleteMock.mock.calls[0] as unknown[])[0]).toBe(replacementKey);
    expect((deleteMock.mock.calls[0] as unknown[])[0]).not.toBe(citedKey);
    expect(auditMock).not.toHaveBeenCalled();
    const download = await downloadGET(new Request("http://t"), pr("5", "1"));
    expect(download.status).toBe(200);
    expect((getMock.mock.calls[0] as unknown[])[0]).toBe(citedKey);
  });

  test.each([
    ["OPEN", null],
    ["ACCEPTED", null],
    ["DISMISSED_WITH_REASON", null],
    ["ACCEPTED", 42],
  ])("%s observation (register item %s) freezes file bytes before body/blob/audit work", async (disposition, registerItemId) => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));
    expect((await uploadPOST(fileReq("cited.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    const citedKey = h.reports[0].sourceFileStorageKey;
    h.observations.push({
      id: 90,
      bidId: 5,
      fieldReportId: 1,
      disposition,
      registerItemId,
      sourceLocator: "p.2/photo 4",
    });
    putMock.mockClear();
    deleteMock.mockClear();
    auditMock.mockClear();
    const request = { formData: vi.fn() } as unknown as Request;

    const response = await uploadPOST(request, pr("5", "1"));
    expect(response.status).toBe(409);
    expect(request.formData).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(auditMock).not.toHaveBeenCalled();
    expect(h.reports[0].sourceFileStorageKey).toBe(citedKey);
  });

  test("Build 1 tracked-item citations also freeze the pointer", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));
    expect((await uploadPOST(fileReq("cited.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    const citedKey = h.reports[0].sourceFileStorageKey;
    h.items.push({ id: 91, bidId: 5, sourceFieldReportId: 1 });
    putMock.mockClear();
    deleteMock.mockClear();

    const response = await uploadPOST(fileReq("replacement.pdf", "application/pdf"), pr("5", "1"));
    expect(response.status).toBe(409);
    expect(putMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(h.reports[0].sourceFileStorageKey).toBe(citedKey);
  });

  test("a historical observation citation resolves the retained bytes through the authenticated download", async () => {
    await createPOST(jsonReq({ title: "Daily" }), p("5"));
    expect((await uploadPOST(fileReq("cited.pdf", "application/pdf"), pr("5", "1"))).status).toBe(201);
    const citedKey = h.reports[0].sourceFileStorageKey;
    h.observations.push({ id: 92, bidId: 5, fieldReportId: 1, disposition: "ACCEPTED", registerItemId: 43, sourceLocator: "p.3" });
    deleteMock.mockClear();

    expect((await uploadPOST(fileReq("replacement.pdf", "application/pdf"), pr("5", "1"))).status).toBe(409);
    const download = await downloadGET(new Request("http://t"), pr("5", "1"));
    expect(download.status).toBe(200);
    expect((getMock.mock.calls[0] as unknown[])[0]).toBe(citedKey);
    expect(Buffer.from(await download.arrayBuffer()).toString()).toBe("retained historical evidence");
    expect(download.headers.get("Cache-Control")).toBe("private, no-store");
    expect(deleteMock).not.toHaveBeenCalled();
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
