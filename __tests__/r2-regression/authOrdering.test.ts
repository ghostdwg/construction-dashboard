// R2 auth/durability regression pack — Area D: authorization ordering.
//
// Behavior-based, call-order proofs (never source-text search) that a denied
// requireBidAccess() short-circuits BEFORE any Prisma read/write, blob I/O,
// body parsing, or outbound provider/sidecar call. The register-route guard
// inventory already exists
// (app/api/bids/[id]/meetings/[meetingId]/register/__tests__/security.test.ts)
// but only covers meetings/register/**. This file independently covers:
//   - the meetings/[meetingId]/analyze route (the ACTUAL sidecar → Claude
//     call site) — confirmed by repo inventory to have NO existing test at
//     all, dedicated or otherwise;
//   - tracked-items attachment upload (blob write ordering);
//   - a call-count matrix across tracked-items / field-reports / register /
//     corrections collection routes.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPrisma, type MockPrisma } from "./support/mockPrisma";
import { withCallCounter } from "./support/countingPrisma";
import { ACTOR_A, BID_A } from "./support/fixtures";

const state = vi.hoisted(() => ({ prisma: null as unknown as MockPrisma, denied: false }));

vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return state.prisma;
  },
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () => {
    if (state.denied) {
      return { ok: false, response: Response.json({ error: "Forbidden" }, { status: 403 }) };
    }
    return { ok: true, user: { id: "user-a", role: "estimator" } };
  }),
}));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: ACTOR_A })),
}));
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({ put: putMock, delete: deleteMock }),
}));
const putMock = vi.hoisted(() => vi.fn(async () => ({ key: "x" })));
const deleteMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/services/settings/appSettingsService", () => ({
  getSetting: vi.fn(async () => "fake-anthropic-key"),
}));
process.env.OBSERVABILITY_AUDIT_QUIET = "true";

import { GET as trackedItemsGET, POST as trackedItemsPOST } from "@/app/api/bids/[id]/tracked-items/route";
import { GET as attachmentsGET, POST as attachmentsPOST } from "@/app/api/bids/[id]/tracked-items/[itemId]/attachments/route";
import { GET as fieldReportsGET, POST as fieldReportsPOST } from "@/app/api/bids/[id]/field-reports/route";
import { GET as registerGET, POST as registerPOST } from "@/app/api/bids/[id]/meetings/[meetingId]/register/route";
import { GET as correctionsGET, POST as correctionsPOST } from "@/app/api/bids/[id]/meetings/[meetingId]/segments/corrections/route";
import { POST as analyzePOST } from "@/app/api/bids/[id]/meetings/[meetingId]/analyze/route";
import { getSetting } from "@/lib/services/settings/appSettingsService";

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const itemParams = (id: string, itemId: string) => ({ params: Promise.resolve({ id, itemId }) });
const meetingParams = (id: string, meetingId: string) => ({ params: Promise.resolve({ id, meetingId }) });
const jsonReq = (body: unknown = {}, method = "POST") =>
  new Request("http://local/x", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const getReq = () => new Request("http://local/x");

beforeEach(() => {
  state.prisma = buildPrisma();
  state.denied = true; // every test in this file exercises the DENIED path
  putMock.mockClear();
  deleteMock.mockClear();
  vi.mocked(getSetting).mockClear();
});

describe("meetings/[meetingId]/analyze — denied access blocks the ENTIRE downstream chain", () => {
  it("zero prisma reads, zero getSetting credential resolution, zero sidecar fetch — the actual Claude call site", async () => {
    const { prisma: counted, counter } = withCallCounter(state.prisma);
    state.prisma = counted;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await analyzePOST(jsonReq({ transcript: "hello" }), meetingParams(String(BID_A), "5"));

    expect(res.status).toBe(403);
    expect(counter.count).toBe(0);
    expect(getSetting).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("tracked-items attachment upload — denied access blocks body parsing AND blob I/O", () => {
  it("zero formData parsing, zero blob put/delete, zero prisma calls, zero tracked-item mutation", async () => {
    const { prisma: counted, counter } = withCallCounter(state.prisma);
    state.prisma = counted;

    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }));
    const formDataSpy = vi.fn(() => Promise.resolve(form));
    const req = { formData: formDataSpy } as unknown as Request;

    const res = await attachmentsPOST(req, itemParams(String(BID_A), "1"));

    expect(res.status).toBe(403);
    expect(formDataSpy).not.toHaveBeenCalled();
    expect(putMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(counter.count).toBe(0);
  });

  it("GET (list) is equally guarded — zero prisma calls when denied", async () => {
    const { prisma: counted, counter } = withCallCounter(state.prisma);
    state.prisma = counted;
    const res = await attachmentsGET(getReq(), itemParams(String(BID_A), "1"));
    expect(res.status).toBe(403);
    expect(counter.count).toBe(0);
  });
});

describe("call-count matrix — every route below performs ZERO prisma work for a denied request", () => {
  const cases: Array<[string, () => Promise<Response>]> = [
    ["GET tracked-items", () => trackedItemsGET(getReq(), idParams(String(BID_A)))],
    ["POST tracked-items", () => trackedItemsPOST(jsonReq({ kind: "OAC_ACTION", title: "x" }), idParams(String(BID_A)))],
    ["GET field-reports", () => fieldReportsGET(getReq(), idParams(String(BID_A)))],
    ["POST field-reports", () => fieldReportsPOST(jsonReq({ title: "x" }), idParams(String(BID_A)))],
    ["GET register", () => registerGET(getReq(), meetingParams(String(BID_A), "5"))],
    ["POST register", () => registerPOST(jsonReq({ entryType: "RISK", normalizedText: "x" }), meetingParams(String(BID_A), "5"))],
    ["GET corrections", () => correctionsGET(getReq(), meetingParams(String(BID_A), "5"))],
    ["POST corrections", () => correctionsPOST(jsonReq({ correctionType: "EDIT_TEXT" }), meetingParams(String(BID_A), "5"))],
  ];

  for (const [name, run] of cases) {
    it(`${name} → 403, zero prisma calls`, async () => {
      const { prisma: counted, counter } = withCallCounter(state.prisma);
      state.prisma = counted;
      const res = await run();
      expect(res.status, name).toBe(403);
      expect(counter.count, name).toBe(0);
    });
  }
});

describe("authorized requests DO proceed to the data layer (control — proves the counter itself works)", () => {
  it("an authorized GET tracked-items makes at least one prisma call", async () => {
    state.denied = false;
    const { prisma: counted, counter } = withCallCounter(state.prisma);
    state.prisma = counted;
    const res = await trackedItemsGET(getReq(), idParams(String(BID_A)));
    expect(res.status).toBe(200);
    expect(counter.count).toBeGreaterThan(0);
  });
});
