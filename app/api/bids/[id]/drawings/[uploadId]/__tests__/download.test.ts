import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  row: { fileName: "plan.pdf", filePath: "uploads/drawings/1/plan.pdf" } as null | {
    fileName: string;
    filePath: string;
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
vi.mock("@/lib/prisma", () => ({ prisma: { drawingUpload: { findFirst } } }));
vi.mock("@/lib/services/drawings/storagePath", () => ({
  readDrawingStorageBuffer: readBuffer,
}));
vi.mock("@/lib/services/storage/referenceSafety", () => ({
  deleteDrawingStorageIfUnreferenced: vi.fn(),
}));

import { GET } from "../route";

const params = { params: Promise.resolve({ id: "1", uploadId: "9" }) };

beforeEach(() => {
  vi.clearAllMocks();
  state.denied = false;
  state.row = { fileName: "plan.pdf", filePath: "uploads/drawings/1/plan.pdf" };
  findFirst.mockImplementation(async () => state.row);
  readBuffer.mockResolvedValue(Buffer.from("drawing bytes"));
});

describe("drawing private download", () => {
  test("serves a server-stored legacy reference with private headers", async () => {
    const response = await GET(new Request("http://local"), params);
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).toString()).toBe("drawing bytes");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(readBuffer).toHaveBeenCalledWith("uploads/drawings/1/plan.pdf", 1);
  });

  test("denies before record lookup or blob read", async () => {
    state.denied = true;
    const response = await GET(new Request("http://local"), params);
    expect(response.status).toBe(404);
    expect(findFirst).not.toHaveBeenCalled();
    expect(readBuffer).not.toHaveBeenCalled();
  });

  test("cross-bid ids and missing blobs use non-oracle 404 responses", async () => {
    state.row = null;
    const crossBid = await GET(new Request("http://local"), params);
    expect(crossBid.status).toBe(404);
    expect(readBuffer).not.toHaveBeenCalled();

    state.row = { fileName: "plan.pdf", filePath: "uploads/drawings/1/plan.pdf" };
    readBuffer.mockRejectedValueOnce(new Error("missing"));
    const missing = await GET(new Request("http://local"), params);
    expect(missing.status).toBe(404);
  });
});
