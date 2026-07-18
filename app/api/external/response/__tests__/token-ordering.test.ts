import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ preflight: vi.fn(), submit: vi.fn(), attachmentPreflight: vi.fn(), externalAttachment: vi.fn(), blobGet: vi.fn(), blobPut: vi.fn(), blobDelete: vi.fn() }));
vi.mock("@/lib/services/tradeResponse/rateLimit", () => ({ checkExternalRateLimit: () => true }));
vi.mock("@/lib/services/tradeResponse/routeHelpers", () => ({
  positiveId: (raw: string) => { const value = Number(raw); return Number.isSafeInteger(value) && value > 0 ? value : null; },
  readJson: async (request: Request) => ({ ok: true, value: await request.json() }),
}));
vi.mock("@/lib/services/tradeResponse/packages", () => ({
  preflightExternalResponseItem: h.preflight,
  submitExternalResponse: h.submit,
  getExternalPackageProjection: vi.fn(),
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

beforeEach(() => { vi.clearAllMocks(); h.preflight.mockResolvedValue({ ok: false, error: "Not found" }); h.attachmentPreflight.mockResolvedValue({ ok: false, error: "Not found" }); h.externalAttachment.mockResolvedValue({ ok: false, error: "Not found" }); h.blobDelete.mockResolvedValue(undefined); });

describe("external token wall ordering and non-oracular failures", () => {
  test("unknown/cross-package submission returns 404 before JSON parsing or mutation", async () => {
    const request = { json: vi.fn(), headers: new Headers() } as unknown as Request;
    const response = await submitPOST(request, { params: Promise.resolve({ token: "synthetic", itemId: "9" }) });
    expect(response.status).toBe(404);
    expect(request.json).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
  });
  test("unknown/cross-package upload returns 404 before multipart or blob work", async () => {
    const request = { formData: vi.fn(), headers: new Headers() } as unknown as Request;
    const response = await uploadPOST(request, { params: Promise.resolve({ token: "synthetic", itemId: "9", revId: "10" }) });
    expect(response.status).toBe(404);
    expect(request.formData).not.toHaveBeenCalled();
    expect(h.blobPut).not.toHaveBeenCalled();
  });
  test("foreign attachment metadata returns 404 before blob read", async () => {
    const response = await downloadGET(new Request("http://test/x"), { params: Promise.resolve({ token: "synthetic", attachmentId: "8" }) });
    expect(response.status).toBe(404);
    expect(h.blobGet).not.toHaveBeenCalled();
  });
  test("valid token-scoped download uses only stored key and private safe headers", async () => {
    h.externalAttachment.mockResolvedValueOnce({ ok: true, value: { storageKey: "plan-room/jobs/7/response-packages/1/5-proof.pdf", fileName: "proof.pdf", mimeType: "application/pdf", byteSize: 4 } });
    h.blobGet.mockResolvedValueOnce(Buffer.from("test"));
    const response = await downloadGET(new Request("http://test/x"), { params: Promise.resolve({ token: "synthetic", attachmentId: "8" }) });
    expect(response.status).toBe(200);
    expect(h.blobGet).toHaveBeenCalledWith("plan-room/jobs/7/response-packages/1/5-proof.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toContain("attachment");
  });
  test("valid upload is package-scoped and metadata/audit failure cleans the written blob", async () => {
    h.attachmentPreflight.mockResolvedValue({ ok: true, value: { bidId: 7, packageId: 1 } });
    h.blobPut.mockResolvedValue({ key: "stored" });
    h.externalAttachment.mockRejectedValueOnce(new Error("audit injection"));
    const form = new FormData(); form.append("file", new File([new Uint8Array([1, 2, 3])], "proof?.pdf", { type: "application/pdf" }));
    const response = await uploadPOST(new Request("http://test/x", { method: "POST", body: form }), { params: Promise.resolve({ token: "synthetic", itemId: "9", revId: "10" }) });
    expect(response.status).toBe(500);
    const storedKey = String(h.blobPut.mock.calls[0]?.[0]);
    expect(storedKey).toMatch(/^plan-room\/jobs\/7\/response-packages\/1\/10-[a-f0-9-]+-proof_\.pdf$/);
    expect(h.blobDelete).toHaveBeenCalledWith(storedKey);
  });
});
