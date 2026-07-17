// OPS private file serving V0 — download-route coverage for tracked-item
// attachments AND field-report source files. Mocked Prisma/BlobStore; no DB,
// no network, no provider or Procore import anywhere on these paths.
import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  item: null as { id: number; bidId: number } | null,
  attachment: null as
    | { id: number; trackedItemId: number; storageKey: string; fileName: string; mimeType: string; byteSize: number }
    | null,
  report: null as
    | {
        id: number;
        bidId: number;
        sourceFileStorageKey: string | null;
        originalFileName: string | null;
        mimeType: string | null;
        byteSize: number | null;
      }
    | null,
}));

const getMock = vi.hoisted(() => vi.fn(async () => Buffer.from([1, 2, 3, 4])));
const accessMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<unknown>>());

vi.mock("@/lib/auth-helpers", () => ({ requireBidAccess: accessMock }));

vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ get: getMock }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    trackedItem: {
      findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) =>
        h.item && h.item.id === where.id && h.item.bidId === where.bidId ? { id: h.item.id } : null
      ),
    },
    trackedItemAttachment: {
      findFirst: vi.fn(async ({ where }: { where: { id: number; trackedItemId: number } }) =>
        h.attachment && h.attachment.id === where.id && h.attachment.trackedItemId === where.trackedItemId
          ? h.attachment
          : null
      ),
    },
    fieldReport: {
      findFirst: vi.fn(async ({ where }: { where: { id: number; bidId: number } }) =>
        h.report && h.report.id === where.id && h.report.bidId === where.bidId ? h.report : null
      ),
    },
  },
}));

import { GET as attachmentDownload } from "../[itemId]/attachments/[attachmentId]/download/route";
import { GET as reportDownload } from "../../field-reports/[fieldReportId]/download/route";

const pa = (id: string, itemId: string, attachmentId: string) => ({
  params: Promise.resolve({ id, itemId, attachmentId }),
});
const pr = (id: string, fieldReportId: string) => ({
  params: Promise.resolve({ id, fieldReportId }),
});

beforeEach(() => {
  h.item = { id: 1, bidId: 5 };
  h.attachment = {
    id: 9,
    trackedItemId: 1,
    storageKey: "plan-room/jobs/5/tracked-items/1/curb.jpg",
    fileName: "curb.jpg",
    mimeType: "image/jpeg",
    byteSize: 4,
  };
  h.report = {
    id: 3,
    bidId: 5,
    sourceFileStorageKey: "plan-room/jobs/5/field-reports/3/daily.pdf",
    originalFileName: "daily.pdf",
    mimeType: "application/pdf",
    byteSize: 4,
  };
  getMock.mockClear();
  accessMock.mockReset();
  accessMock.mockResolvedValue({ ok: true, user: { id: "user-1" } });
  getMock.mockResolvedValue(Buffer.from([1, 2, 3, 4]));
});

describe("private download routes", () => {
  test("bid authorization denial occurs before metadata and blob reads", async () => {
    accessMock.mockResolvedValueOnce({
      ok: false,
      response: Response.json({ error: "Not found" }, { status: 404 }),
    });
    const res = await attachmentDownload(new Request("http://t"), pa("6", "1", "9"));
    expect(res.status).toBe(404);
    expect(getMock).not.toHaveBeenCalled();
  });
  test("attachment download: same-bid succeeds with safe headers; server-stored key used", async () => {
    // A hostile query param naming another key must be ignored — the route
    // takes ids only and reads the SERVER-stored storageKey.
    const res = await attachmentDownload(
      new Request("http://t/x?key=/etc/passwd&storageKey=../../.env"),
      pa("5", "1", "9")
    );
    expect(res.status).toBe(200);
    expect((getMock.mock.calls[0] as unknown[])[0]).toBe(
      "plan-room/jobs/5/tracked-items/1/curb.jpg"
    );
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="curb.jpg"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  test("attachment download: cross-bid blocked BEFORE any blob read", async () => {
    const res = await attachmentDownload(new Request("http://t"), pa("6", "1", "9"));
    expect(res.status).toBe(404);
    expect(getMock).not.toHaveBeenCalled();
  });

  test("attachment download: attachment not belonging to the item blocked before blob read", async () => {
    h.attachment!.trackedItemId = 2; // belongs to a different item
    const res = await attachmentDownload(new Request("http://t"), pa("5", "1", "9"));
    expect(res.status).toBe(404);
    expect(getMock).not.toHaveBeenCalled();
  });

  test("attachment download: metadata row with missing blob returns honest 404", async () => {
    getMock.mockRejectedValueOnce(new Error("blob not found (simulated)"));
    const res = await attachmentDownload(new Request("http://t"), pa("5", "1", "9"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/missing from storage/i);
  });

  test("attachment download: unknown stored mime serves as octet-stream (never sniffed)", async () => {
    h.attachment!.mimeType = "text/html"; // hostile/legacy value
    const res = await attachmentDownload(new Request("http://t"), pa("5", "1", "9"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("report download: same-bid succeeds with safe headers; server-stored key used", async () => {
    const res = await reportDownload(new Request("http://t/x?key=evil"), pr("5", "3"));
    expect(res.status).toBe(200);
    expect((getMock.mock.calls[0] as unknown[])[0]).toBe(
      "plan-room/jobs/5/field-reports/3/daily.pdf"
    );
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="daily.pdf"');
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("report download: cross-bid blocked BEFORE any blob read", async () => {
    const res = await reportDownload(new Request("http://t"), pr("6", "3"));
    expect(res.status).toBe(404);
    expect(getMock).not.toHaveBeenCalled();
  });

  test("report download: report without an uploaded file returns clear 404, no blob read", async () => {
    h.report!.sourceFileStorageKey = null;
    const res = await reportDownload(new Request("http://t"), pr("5", "3"));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/no file has been uploaded/i);
    expect(getMock).not.toHaveBeenCalled();
  });

  test("hostile stored filename is sanitized in Content-Disposition", async () => {
    h.attachment!.fileName = '../we"ird\r\nname.jpg';
    const res = await attachmentDownload(new Request("http://t"), pa("5", "1", "9"));
    const disposition = res.headers.get("Content-Disposition")!;
    expect(disposition.startsWith("attachment; filename=\"")).toBe(true);
    expect(disposition).not.toContain("..");
    expect(disposition).not.toContain("\r");
    expect(disposition).not.toContain("\n");
    expect(disposition.match(/"/g)!.length).toBe(2); // only the wrapping quotes
  });
});
