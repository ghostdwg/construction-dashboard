import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  context: vi.fn(),
  readJson: vi.fn(),
  service: vi.fn(),
  blobGet: vi.fn(),
  blobPut: vi.fn(),
}));

vi.mock("@/lib/services/tradeResponse/routeHelpers", () => ({
  bidRouteContext: h.context,
  positiveId: (raw: string) => { const value = Number(raw); return Number.isSafeInteger(value) && value > 0 ? value : null; },
  readJson: h.readJson,
}));
vi.mock("@/lib/services/tradeResponse/observations", () => ({
  createReportObservation: h.service, listReportObservations: h.service, updateOpenObservation: h.service,
  dispositionObservation: h.service, promoteObservation: h.service, linkObservation: h.service, assignTrackedItemTrades: h.service,
}));
vi.mock("@/lib/services/tradeResponse/packages", () => ({
  createResponsePackage: h.service, listResponsePackages: h.service, getResponsePackage: h.service,
  changePackageItem: h.service, issueResponsePackage: h.service, rotateResponsePackageToken: h.service, revokePackageTokens: h.service,
  transitionResponsePackage: h.service, submitManualResponse: h.service, reviewTradeResponse: h.service,
}));
vi.mock("@/lib/services/tradeResponse/attachments", () => ({
  getInternalAttachmentTarget: h.service, recordInternalResponseAttachment: h.service, findInternalResponseAttachment: h.service,
}));
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ get: h.blobGet, put: h.blobPut, delete: vi.fn() }),
  safeBlobFileName: (name: string) => name,
}));

import { GET as observationsGET, POST as observationsPOST } from "../../observations/route";
import { POST as fieldObservationPOST } from "../../field-reports/[fieldReportId]/observations/route";
import { PATCH as observationPATCH } from "../../observations/[obsId]/route";
import { POST as dispositionPOST } from "../../observations/[obsId]/disposition/route";
import { POST as promotePOST } from "../../observations/[obsId]/promote/route";
import { POST as linkPOST } from "../../observations/[obsId]/link/route";
import { PUT as tradesPUT } from "../../tracked-items/[itemId]/trade-assignments/route";
import { GET as packagesGET, POST as packagesPOST } from "../route";
import { GET as packageGET } from "../[pkgId]/route";
import { POST as itemsPOST } from "../[pkgId]/items/route";
import { POST as issuePOST } from "../[pkgId]/issue/route";
import { POST as rotatePOST } from "../[pkgId]/rotate-token/route";
import { POST as revokePOST } from "../[pkgId]/revoke-token/route";
import { POST as statusPOST } from "../[pkgId]/status/route";
import { POST as responsePOST } from "../[pkgId]/items/[itemId]/responses/route";
import { POST as reviewPOST } from "../[pkgId]/items/[itemId]/responses/[revId]/gc-review/route";
import { POST as attachmentPOST } from "../[pkgId]/items/[itemId]/responses/[revId]/attachments/route";
import { GET as attachmentGET } from "../[pkgId]/items/[itemId]/responses/[revId]/attachments/[attachmentId]/download/route";

beforeEach(() => {
  vi.clearAllMocks();
  h.context.mockResolvedValue({ ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) });
});

describe("every R2 Build 2 internal route denies before body/DB/blob work", () => {
  test("cross-bid denial matrix has zero downstream work", async () => {
    const request = { json: vi.fn(), formData: vi.fn(), headers: new Headers() } as unknown as Request;
    const cases: Array<() => Promise<Response>> = [
      () => observationsGET(request, { params: Promise.resolve({ id: "7" }) }),
      () => observationsPOST(request, { params: Promise.resolve({ id: "7" }) }),
      () => fieldObservationPOST(request, { params: Promise.resolve({ id: "7", fieldReportId: "2" }) }),
      () => observationPATCH(request, { params: Promise.resolve({ id: "7", obsId: "2" }) }),
      () => dispositionPOST(request, { params: Promise.resolve({ id: "7", obsId: "2" }) }),
      () => promotePOST(request, { params: Promise.resolve({ id: "7", obsId: "2" }) }),
      () => linkPOST(request, { params: Promise.resolve({ id: "7", obsId: "2" }) }),
      () => tradesPUT(request, { params: Promise.resolve({ id: "7", itemId: "2" }) }),
      () => packagesGET(request, { params: Promise.resolve({ id: "7" }) }),
      () => packagesPOST(request, { params: Promise.resolve({ id: "7" }) }),
      () => packageGET(request, { params: Promise.resolve({ id: "7", pkgId: "2" }) }),
      () => itemsPOST(request, { params: Promise.resolve({ id: "7", pkgId: "2" }) }),
      () => issuePOST(request, { params: Promise.resolve({ id: "7", pkgId: "2" }) }),
      () => rotatePOST(request, { params: Promise.resolve({ id: "7", pkgId: "2" }) }),
      () => revokePOST(request, { params: Promise.resolve({ id: "7", pkgId: "2" }) }),
      () => statusPOST(request, { params: Promise.resolve({ id: "7", pkgId: "2" }) }),
      () => responsePOST(request, { params: Promise.resolve({ id: "7", pkgId: "2", itemId: "3" }) }),
      () => reviewPOST(request, { params: Promise.resolve({ id: "7", pkgId: "2", itemId: "3", revId: "4" }) }),
      () => attachmentPOST(request, { params: Promise.resolve({ id: "7", pkgId: "2", itemId: "3", revId: "4" }) }),
      () => attachmentGET(request, { params: Promise.resolve({ id: "7", pkgId: "2", itemId: "3", revId: "4", attachmentId: "5" }) }),
    ];
    for (const invoke of cases) expect((await invoke()).status).toBe(404);
    expect(h.context).toHaveBeenCalledTimes(cases.length);
    expect(h.readJson).not.toHaveBeenCalled();
    expect(request.json).not.toHaveBeenCalled();
    expect(request.formData).not.toHaveBeenCalled();
    expect(h.service).not.toHaveBeenCalled();
    expect(h.blobGet).not.toHaveBeenCalled();
    expect(h.blobPut).not.toHaveBeenCalled();
  });
  test("authorized routes pass raw runtime discriminants to fail-closed services without coercion", async () => {
    h.context.mockResolvedValue({ ok: true, bidId: 7, actor: { id: "user-1" } });
    h.readJson.mockResolvedValueOnce({ ok: true, value: { action: "BOGUS", trackedItemId: 9 } });
    h.service.mockResolvedValueOnce({ ok: false, error: "Invalid package item action" });
    let response = await itemsPOST(new Request("http://test/x", { method: "POST" }), { params: Promise.resolve({ id: "7", pkgId: "2" }) });
    expect(response.status).toBe(400);
    expect(h.service).toHaveBeenLastCalledWith(7, 2, { action: "BOGUS", trackedItemId: 9 }, { id: "user-1" });

    h.readJson.mockResolvedValueOnce({ ok: true, value: { delivery: "BOGUS", manualChannel: "EMAIL" } });
    h.service.mockResolvedValueOnce({ ok: false, error: "Invalid delivery mechanism" });
    response = await issuePOST(new Request("http://test/x", { method: "POST" }), { params: Promise.resolve({ id: "7", pkgId: "2" }) });
    expect(response.status).toBe(400);
    expect(h.service).toHaveBeenLastCalledWith(7, 2, { delivery: "BOGUS", manualChannel: "EMAIL", expiresAt: null }, { id: "user-1" });
  });
  test("authorized internal attachment download remains parent-scoped and private", async () => {
    h.context.mockResolvedValueOnce({ ok: true, bidId: 7, actor: { id: "user-1" } });
    h.service.mockResolvedValueOnce({ storageKey: "plan-room/jobs/7/response-packages/2/4-proof.pdf", fileName: "proof.pdf", mimeType: "application/pdf", byteSize: 4 });
    h.blobGet.mockResolvedValueOnce(Buffer.from("test"));
    const response = await attachmentGET(new Request("http://test/x"), { params: Promise.resolve({ id: "7", pkgId: "2", itemId: "3", revId: "4", attachmentId: "5" }) });
    expect(response.status).toBe(200);
    expect(h.blobGet).toHaveBeenCalledWith("plan-room/jobs/7/response-packages/2/4-proof.pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
