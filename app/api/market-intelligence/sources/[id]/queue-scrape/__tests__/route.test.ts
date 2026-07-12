import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  create: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    marketSource: { findUnique: h.findUnique },
    backgroundJob: { create: h.create },
  },
}));

import { POST } from "../route";

function makeRequest(body: unknown = {}): Request {
  const payload = JSON.stringify(body);
  return new Request("http://localhost/api/market-intelligence/sources/src_abc/queue-scrape", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(payload, "utf-8")),
    },
    body: payload,
  });
}

function paramsFor(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

const ACTIVE_SOURCE = { id: "src_abc", name: "Ankeny P&Z", isActive: true };

beforeEach(() => { vi.clearAllMocks(); });

describe("POST /api/market-intelligence/sources/[id]/queue-scrape", () => {
  it("creates job with dedupeKey = 'market_scrape:<sourceId>'", async () => {
    h.findUnique.mockResolvedValue(ACTIVE_SOURCE);
    h.create.mockResolvedValue({ id: "job_1", runAfter: new Date().toISOString() });

    const res = await POST(makeRequest(), paramsFor("src_abc"));
    expect(res.status).toBe(201);

    const [createCall] = h.create.mock.calls;
    expect(createCall[0].data.dedupeKey).toBe("market_scrape:src_abc");
    expect(createCall[0].data.jobType).toBe("market_scrape");
    expect(createCall[0].data.relatedId).toBe("src_abc");
  });

  it("returns 404 when source not found", async () => {
    h.findUnique.mockResolvedValue(null);
    const res = await POST(makeRequest(), paramsFor("missing"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when source is inactive", async () => {
    h.findUnique.mockResolvedValue({ ...ACTIVE_SOURCE, isActive: false });
    const res = await POST(makeRequest(), paramsFor("src_abc"));
    expect(res.status).toBe(400);
  });

  it("returns 409 on unique constraint violation (dedupe guard working)", async () => {
    h.findUnique.mockResolvedValue(ACTIVE_SOURCE);
    h.create.mockRejectedValue(new Error("Unique constraint failed on field dedupeKey"));

    const res = await POST(makeRequest(), paramsFor("src_abc"));
    expect(res.status).toBe(409);
  });
});
