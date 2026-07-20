import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  row: { fileName: "addendum.pdf", storageKey: "uploads/addendums/1/addendum.pdf" } as null | {
    fileName: string;
    storageKey: string | null;
  },
}));
const readBuffer = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () =>
    state.denied
      ? { ok: false, response: Response.json({ error: "Not found" }, { status: 404 }) }
      : { ok: true, user: { id: "u1", role: "estimator" } },
  ),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { addendumUpload: { findFirst } } }));
vi.mock("@/lib/services/addendums/storagePath", () => ({
  readAddendumStorageBuffer: readBuffer,
}));
vi.mock("@/lib/services/storage/referenceSafety", () => ({
  deleteAddendumStorageIfUnreferenced: vi.fn(),
}));
vi.mock("@/lib/services/jobs/briefRefreshAutomation", () => ({ triggerBriefRefresh: vi.fn() }));
vi.mock("@/lib/services/settings/documentAutomation", () => ({ documentAutomationStatus: vi.fn() }));
vi.mock("@/lib/env", () => ({ env: { APP_ENV: "test" } }));

import { GET } from "../route";

const params = { params: Promise.resolve({ id: "1", addendumId: "9" }) };

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
  state.row = { fileName: "addendum.pdf", storageKey: "uploads/addendums/1/addendum.pdf" };
  findFirst.mockImplementation(async () => state.row);
  readBuffer.mockResolvedValue(Buffer.from("addendum bytes"));
});

describe("addendum private download", () => {
  test("serves a legacy key without exposing it", async () => {
    const response = await GET(new Request("http://local"), params);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("addendum bytes");
    expect(response.headers.get("content-disposition")).toContain("addendum.pdf");
    expect(readBuffer).toHaveBeenCalledWith("uploads/addendums/1/addendum.pdf", 1);
  });

  test("denies before database and storage access", async () => {
    state.denied = true;
    const response = await GET(new Request("http://local"), params);
    expect(response.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
    expect(readBuffer).not.toHaveBeenCalled();
  });

  test("cross-bid rows, null legacy records, and missing blobs return 404", async () => {
    state.row = null;
    expect((await GET(new Request("http://local"), params)).status).toBe(404);
    state.row = { fileName: "historic.pdf", storageKey: null };
    expect((await GET(new Request("http://local"), params)).status).toBe(404);
    state.row = { fileName: "addendum.pdf", storageKey: "uploads/addendums/1/addendum.pdf" };
    readBuffer.mockRejectedValueOnce(new Error("missing"));
    expect((await GET(new Request("http://local"), params)).status).toBe(404);
  });
});
