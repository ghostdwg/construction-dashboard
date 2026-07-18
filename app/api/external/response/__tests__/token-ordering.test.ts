import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ projection: vi.fn(), preflight: vi.fn(), submit: vi.fn(), attachmentPreflight: vi.fn(), externalAttachment: vi.fn(), blobGet: vi.fn(), blobPut: vi.fn(), blobDelete: vi.fn() }));
vi.mock("@/lib/services/tradeResponse/rateLimit", () => ({ checkExternalRateLimit: () => true }));
vi.mock("@/lib/services/tradeResponse/routeHelpers", () => ({
  positiveId: (raw: string) => { const value = Number(raw); return Number.isSafeInteger(value) && value > 0 ? value : null; },
  readJson: async (request: Request) => ({ ok: true, value: await request.json() }),
}));
vi.mock("@/lib/services/tradeResponse/packages", () => ({
  preflightExternalResponseItem: h.preflight,
  submitExternalResponse: h.submit,
  getExternalPackageProjection: h.projection,
}));
vi.mock("@/lib/services/tradeResponse/attachments", () => ({
  preflightExternalAttachmentTarget: h.attachmentPreflight,
  recordExternalResponseAttachment: h.externalAttachment,
  findExternalResponseAttachment: h.externalAttachment,
}));
vi.mock("@/lib/storage/blobStore", () => ({ getBlobStore: () => ({ get: h.blobGet, put: h.blobPut, delete: h.blobDelete }), safeBlobFileName: (name: string) => name.replace(/[^A-Za-z0-9._() -]/g, "_") }));

import { POST as submitPOST } from "../[token]/items/[itemId]/responses/route";
import { POST as uploadPOST } from "../[token]/items/[itemId]/responses/[revId]/attachments/route";
import { GET as downloadGET } from "../[token]/attachments/[attachmentId]/download/route";
import { GET as packageGET } from "../[token]/route";

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
}

beforeEach(() => { vi.clearAllMocks(); h.projection.mockResolvedValue({ ok: false, error: "Not found" }); h.preflight.mockResolvedValue({ ok: false, error: "Not found" }); h.attachmentPreflight.mockResolvedValue({ ok: false, error: "Not found" }); h.externalAttachment.mockResolvedValue({ ok: false, error: "Not found" }); h.blobDelete.mockResolvedValue(undefined); });

describe("external token wall ordering and non-oracular failures", () => {
  test("package projections and failures are private and non-cacheable", async () => {
    let response = await packageGET(new Request("http://test/x"), { params: Promise.resolve({ token: "synthetic" }) });
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    h.projection.mockResolvedValueOnce({ ok: true, value: { packageNumber: 1, items: [] } });
    response = await packageGET(new Request("http://test/x"), { params: Promise.resolve({ token: "synthetic" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  test("unknown/cross-package submission returns 404 before JSON parsing or mutation", async () => {
    const request = { json: vi.fn(), headers: new Headers() } as unknown as Request;
    const response = await submitPOST(request, { params: Promise.resolve({ token: "synthetic", itemId: "9" }) });
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(request.json).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
  test("unknown/cross-package upload returns 404 before multipart or blob work", async () => {
    const request = { formData: vi.fn(), headers: new Headers() } as unknown as Request;
    const response = await uploadPOST(request, { params: Promise.resolve({ token: "synthetic", itemId: "9", revId: "10" }) });
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(request.formData).not.toHaveBeenCalled();
    expect(h.blobPut).not.toHaveBeenCalled();
  });
  test("foreign attachment metadata returns 404 before blob read", async () => {
    const response = await downloadGET(new Request("http://test/x"), { params: Promise.resolve({ token: "synthetic", attachmentId: "8" }) });
    expect(response.status).toBe(404);
    expect(h.blobGet).not.toHaveBeenCalled();
  });
  test("valid token-scoped download uses only stored key and private safe headers", async () => {
    h.externalAttachment.mockResolvedValue({ ok: true, value: { storageKey: "plan-room/jobs/7/response-packages/1/5-proof.pdf", fileName: "proof.pdf", mimeType: "application/pdf", byteSize: 4 } });
    h.blobGet.mockResolvedValueOnce(Buffer.from("test"));
    const response = await downloadGET(new Request("http://test/x"), { params: Promise.resolve({ token: "synthetic", attachmentId: "8" }) });
    expect(response.status).toBe(200);
    expect(h.blobGet).toHaveBeenCalledWith("plan-room/jobs/7/response-packages/1/5-proof.pdf");
    expectPrivate(response);
    expect(response.headers.get("content-disposition")).toContain("attachment");
  });
  test("revocation between metadata and blob boundary returns private 404 with zero blob access", async () => {
    h.externalAttachment
      .mockResolvedValueOnce({ ok: true, value: { storageKey: "plan-room/jobs/7/response-packages/1/5-proof.pdf", fileName: "proof.pdf", mimeType: "application/pdf", byteSize: 4 } })
      .mockResolvedValueOnce({ ok: false, error: "Not found" });
    const response = await downloadGET(new Request("http://test/x"), { params: Promise.resolve({ token: "synthetic", attachmentId: "8" }) });
    expect(response.status).toBe(404);
    expectPrivate(response);
    expect(h.blobGet).not.toHaveBeenCalled();
  });
  test("valid upload is package-scoped and metadata/audit failure cleans the written blob", async () => {
    h.attachmentPreflight.mockResolvedValue({ ok: true, value: { bidId: 7, packageId: 1 } });
    h.blobPut.mockResolvedValue({ key: "stored" });
    h.externalAttachment.mockRejectedValueOnce(new Error("audit injection"));
    const form = new FormData(); form.append("file", new File([new Uint8Array([1, 2, 3])], "proof?.pdf", { type: "application/pdf" }));
    const response = await uploadPOST(new Request("http://test/x", { method: "POST", body: form }), { params: Promise.resolve({ token: "synthetic", itemId: "9", revId: "10" }) });
    expect(response.status).toBe(500);
    expectPrivate(response);
    const storedKey = String(h.blobPut.mock.calls[0]?.[0]);
    expect(storedKey).toMatch(/^plan-room\/jobs\/7\/response-packages\/1\/10-[a-f0-9-]+-proof_\.pdf$/);
    expect(h.blobDelete).toHaveBeenCalledWith(storedKey);
  });
  test("successful submission and upload responses are private and non-cacheable", async () => {
    h.preflight.mockResolvedValue({ ok: true, value: { bidId: 7, packageId: 1 } });
    h.submit.mockResolvedValue({ ok: true, value: { id: 10, revisionIndex: 0 } });
    let response = await submitPOST(new Request("http://test/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ responderName: "Synthetic", responseType: "COMPLETED", responseText: "Synthetic response" }) }), { params: Promise.resolve({ token: "synthetic", itemId: "9" }) });
    expect(response.status).toBe(201);
    expectPrivate(response);

    h.attachmentPreflight.mockResolvedValue({ ok: true, value: { bidId: 7, packageId: 1 } });
    h.externalAttachment.mockResolvedValue({ ok: true, value: { id: 12 } });
    h.blobPut.mockResolvedValue({ key: "stored" });
    const form = new FormData(); form.append("file", new File([new Uint8Array([1, 2, 3])], "proof.pdf", { type: "application/pdf" }));
    response = await uploadPOST(new Request("http://test/x", { method: "POST", body: form }), { params: Promise.resolve({ token: "synthetic", itemId: "9", revId: "10" }) });
    expect(response.status).toBe(201);
    expectPrivate(response);
  });
});
