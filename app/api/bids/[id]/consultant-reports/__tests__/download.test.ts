// Module OPS3 (Phase 1A) — inline + attachment serving. The inline route is
// a header VARIANT of the proven private-download pattern: identical
// tenancy-before-blob-read order, identical nosniff/no-store policy — the
// only difference is Content-Disposition. Both must reject a foreign-bid
// resource identically, BEFORE any blob access.
import { beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number };

const h = vi.hoisted(() => ({
  reports: [] as Row[],
  revisions: [] as Row[],
  blobs: new Map<string, Buffer>(),
}));

const getMock = vi.hoisted(() =>
  vi.fn(async (key: string) => {
    const buf = h.blobs.get(key);
    if (!buf) throw new Error("missing blob");
    return buf;
  })
);

vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ get: getMock }),
}));

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    consultantReport: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.reports.find((r) => matches(r, where));
        return found ? { ...found } : null;
      }),
    },
    consultantReportRevision: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const sorted = [...h.revisions].sort(
          (a, b) => (b.revisionIndex as number) - (a.revisionIndex as number)
        );
        const found = sorted.find((r) => matches(r, where));
        return found ? { ...found } : null;
      }),
    },
  },
}));

import { GET as inlineGET } from "../[reportId]/route";
import { GET as downloadGET } from "../[reportId]/download/route";

const pr = (id: string, reportId: string) => ({
  params: Promise.resolve({ id, reportId }),
});
const req = (url = "http://test/x") => new Request(url);

const PDF = Buffer.from("%PDF-1.7\nreport body", "ascii");

beforeEach(() => {
  h.reports.length = 0;
  h.revisions.length = 0;
  h.blobs.clear();
  getMock.mockClear();

  h.reports.push({ id: 10, bidId: 1, status: "ACTIVE" });
  h.revisions.push({
    id: 100,
    reportId: 10,
    bidId: 1,
    revisionIndex: 0,
    storedKey: "plan-room/jobs/1/consultant-reports/aaa.pdf",
    originalFilename: "JSO-14.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: PDF.byteLength,
  });
  h.blobs.set("plan-room/jobs/1/consultant-reports/aaa.pdf", PDF);
});

describe("GET [reportId] (inline)", () => {
  test("serves the PDF inline with the full private-header policy", async () => {
    const res = await inlineGET(req(), pr("1", "10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('inline; filename="JSO-14.pdf"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  test("cross-project request → 404 and the blob is NEVER read", async () => {
    const res = await inlineGET(req(), pr("2", "10"));
    expect(res.status).toBe(404);
    expect(getMock).not.toHaveBeenCalled();
  });

  test("serves the LATEST revision by default", async () => {
    const corrected = Buffer.from("%PDF-1.7\ncorrected body", "ascii");
    h.revisions.push({
      id: 101,
      reportId: 10,
      bidId: 1,
      revisionIndex: 1,
      storedKey: "plan-room/jobs/1/consultant-reports/bbb.pdf",
      originalFilename: "JSO-14-r1.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: corrected.byteLength,
    });
    h.blobs.set("plan-room/jobs/1/consultant-reports/bbb.pdf", corrected);
    const res = await inlineGET(req(), pr("1", "10"));
    expect(Buffer.from(await res.arrayBuffer()).equals(corrected)).toBe(true);
  });

  test("a superseded revision stays servable via ?revisionId=", async () => {
    h.revisions.push({
      id: 101,
      reportId: 10,
      bidId: 1,
      revisionIndex: 1,
      storedKey: "plan-room/jobs/1/consultant-reports/bbb.pdf",
      originalFilename: "JSO-14-r1.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 10,
    });
    h.blobs.set("plan-room/jobs/1/consultant-reports/bbb.pdf", Buffer.from("%PDF-x"));
    const res = await inlineGET(req("http://test/x?revisionId=100"), pr("1", "10"));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  test("a revisionId from ANOTHER report/bid → 404 (no cross-resource key reach)", async () => {
    h.reports.push({ id: 20, bidId: 2, status: "ACTIVE" });
    h.revisions.push({
      id: 200,
      reportId: 20,
      bidId: 2,
      revisionIndex: 0,
      storedKey: "plan-room/jobs/2/consultant-reports/ccc.pdf",
      originalFilename: "other.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 10,
    });
    const res = await inlineGET(req("http://test/x?revisionId=200"), pr("1", "10"));
    expect(res.status).toBe(404);
    expect(getMock).not.toHaveBeenCalled();
  });

  test("metadata row whose blob is missing → honest 404", async () => {
    h.blobs.clear();
    const res = await inlineGET(req(), pr("1", "10"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/missing from storage/);
  });
});

describe("GET [reportId]/download (attachment)", () => {
  test("identical policy with attachment disposition", async () => {
    const res = await downloadGET(req(), pr("1", "10"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="JSO-14.pdf"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("cross-project request → 404 identically, blob never read", async () => {
    const res = await downloadGET(req(), pr("2", "10"));
    expect(res.status).toBe(404);
    expect(getMock).not.toHaveBeenCalled();
  });
});
