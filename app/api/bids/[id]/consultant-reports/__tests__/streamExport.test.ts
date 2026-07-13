// Module OPS6 (Phase 2) — stream export coverage: cap precheck before any
// sidecar contact, SSE event sequence, per-bid 429, zero-copy response
// rule in the payload, immutable export record, authenticated download.
// Mocked Prisma/auth/blobStore + mocked sidecar fetch — no DB, no network,
// no render, no provider anywhere.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type Row = Record<string, unknown> & { id: number | string };

const h = vi.hoisted(() => ({
  bidExists: true,
  observations: [] as Row[],
  exports: [] as Row[],
  audits: [] as Array<{ action: string; payload: Record<string, unknown> | undefined }>,
  blobs: new Map<string, Buffer>(),
  authOk: true,
  nextId: 1,
}));

const auditMock = vi.hoisted(() =>
  vi.fn(async (input: { action: string; payload?: Record<string, unknown> }) => {
    h.audits.push({ action: input.action, payload: input.payload });
  })
);

vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: auditMock }));
vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({ user: { name: "Josh", email: "josh@example.test" } })),
}));
vi.mock("@/lib/auth-helpers", () => ({
  requireBidAccess: vi.fn(async () =>
    h.authOk
      ? { ok: true, user: { id: "u1", role: "admin" } }
      : {
          ok: false,
          response: Response.json({ error: "Authentication required" }, { status: 401 }),
        }
  ),
}));
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({
    put: vi.fn(async (key: string, buf: Buffer) => {
      h.blobs.set(key, buf);
      return { key };
    }),
    get: vi.fn(async (key: string) => {
      const buf = h.blobs.get(key);
      if (!buf) throw new Error("missing blob");
      return buf;
    }),
  }),
}));

const matches = (row: Row, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "state" && typeof v === "object" && v !== null && "not" in (v as object)) {
      return row.state !== (v as { not: string }).not;
    }
    if (k === "id" && typeof v === "object" && v !== null && "in" in (v as object)) {
      return ((v as { in: number[] }).in).includes(row.id as number);
    }
    if (k === "report") return true; // date-range filtering exercised via count parity, not re-implemented
    return row[k] === v;
  });

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bid: {
      findUnique: vi.fn(async () =>
        h.bidExists ? { projectName: "Iowa Hearing Center" } : null
      ),
    },
    consultantObservation: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        h.observations.filter((o) => matches(o, where)).length
      ),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        h.observations.filter((o) => matches(o, where)).map((o) => ({ ...o }))
      ),
    },
    consultantStreamExport: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `exp-${h.nextId++}`, generatedAt: new Date(0), ...data } as Row;
        h.exports.push(row);
        return { id: row.id };
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const found = h.exports.find((e) => matches(e, where));
        return found ? { ...found } : null;
      }),
    },
  },
}));

import { POST as exportPOST } from "../export-pdf/route";
import { GET as downloadGET } from "../export-pdf/[exportId]/download/route";

const p = (id: string) => ({ params: Promise.resolve({ id }) });
const pd = (id: string, exportId: string) => ({
  params: Promise.resolve({ id, exportId }),
});
const jsonReq = (body: unknown) =>
  new Request("http://test/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

function makeObs(overrides: Partial<Row> = {}): Row {
  return {
    id: h.nextId++,
    bidId: 1,
    observationText: "Handrail at stair 2 not yet installed",
    sourcePage: "p.3",
    consultantTargetDate: new Date("2026-07-18T00:00:00.000Z"),
    state: "ENTERED",
    dismissedReason: null,
    createdAt: new Date(h.nextId),
    report: {
      id: 10,
      vendorName: "IMEG",
      title: null,
      reportNumber: "#3",
      reportType: "ENGINEER_FIELD_REPORT",
      reportDate: new Date("2026-07-01T00:00:00.000Z"),
      status: "ACTIVE",
      _count: { revisions: 1 },
    },
    registerItem: null,
    dispositions: [],
    ...overrides,
  };
}

const PDF = Buffer.from("%PDF-1.7 rendered", "ascii");
const fetchMock = vi.fn();

async function readSse(res: Response): Promise<Array<{ event: string; data: Record<string, unknown> }>> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] ?? "";
      const data = JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? "{}") as Record<string, unknown>;
      return { event, data };
    });
}

beforeEach(() => {
  h.bidExists = true;
  h.observations.length = 0;
  h.exports.length = 0;
  h.audits.length = 0;
  h.blobs.clear();
  h.authOk = true;
  h.nextId = 1;
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(new Uint8Array(PDF), {
      status: 200,
      headers: { "Content-Type": "application/pdf" },
    })
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST export-pdf (SSE)", () => {
  test("happy path: progress events, done with authenticated downloadUrl, immutable record + blob + audit", async () => {
    h.observations.push(makeObs(), makeObs());
    const res = await exportPOST(jsonReq({}), p("1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const events = await readSse(res);
    expect(events.map((e) => e.event)).toEqual(["progress", "progress", "progress", "done"]);
    expect(events.slice(0, 3).map((e) => e.data.stage)).toEqual([
      "fetching", "rendering", "storing",
    ]);
    const done = events[3].data as { downloadUrl: string; exportId: string; observationCount: number };
    expect(done.observationCount).toBe(2);
    expect(done.downloadUrl).toBe(
      `/api/bids/1/consultant-reports/export-pdf/${done.exportId}/download`
    );

    expect(h.exports).toHaveLength(1);
    expect(h.exports[0].observationCount).toBe(2);
    expect(String(h.exports[0].storedKey)).toMatch(
      /^plan-room\/jobs\/1\/consultant-stream-exports\/[0-9a-f]{64}\.pdf$/
    );
    expect(h.blobs.size).toBe(1);
    expect(h.audits.map((a) => a.action)).toContain("stream_export_generated");
    // Audit payload never carries observation text.
    expect(JSON.stringify(h.audits)).not.toContain("Handrail");
  });

  test("zero-copy rule: shared formal response renders once, later citations are refs", async () => {
    const item = {
      id: 7,
      title: "Fix handrail",
      status: "IN_PROGRESS",
      dueDate: new Date("2026-07-15T00:00:00.000Z"),
      formalResponse: "We will re-install per detail 5/A501.",
      formalResponseBy: "josh@example.test",
      formalResponseAt: new Date("2026-07-10T00:00:00.000Z"),
    };
    h.observations.push(
      makeObs({ state: "ACCEPTED_NEW_ITEM", registerItem: item }),
      makeObs({ state: "ACCEPTED_LINKED_ITEM", registerItem: item })
    );
    await readSse(await exportPOST(jsonReq({}), p("1")));

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      reports: Array<{ observations: Array<{ registerItem: { formalResponse: string | null; responseRef: boolean } }> }>;
    };
    const rows = payload.reports[0].observations;
    expect(rows[0].registerItem.formalResponse).toContain("re-install");
    expect(rows[0].registerItem.responseRef).toBe(false);
    expect(rows[1].registerItem.formalResponse).toBeNull();
    expect(rows[1].registerItem.responseRef).toBe(true);
  });

  test("includeDisposed toggles DISMISSED observations in the count and payload", async () => {
    h.observations.push(makeObs(), makeObs({ state: "DISMISSED" }));
    await readSse(await exportPOST(jsonReq({}), p("1")));
    let payload = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      reports: Array<{ observations: unknown[] }>;
    };
    expect(payload.reports[0].observations).toHaveLength(1);

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(PDF), { status: 200 })
    );
    await readSse(await exportPOST(jsonReq({ includeDisposed: true }), p("1")));
    payload = JSON.parse(String(fetchMock.mock.calls[0][1].body)) as {
      reports: Array<{ observations: unknown[] }>;
    };
    expect(payload.reports[0].observations).toHaveLength(2);
  });

  test("over-cap → 400 with guidance BEFORE any sidecar contact", async () => {
    for (let i = 0; i < 501; i++) h.observations.push(makeObs());
    const res = await exportPOST(jsonReq({}), p("1"));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/capped at 500/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.exports).toHaveLength(0);
  });

  test("zero matches → 400; unauthenticated → 401; invalid filters → 400", async () => {
    expect((await exportPOST(jsonReq({}), p("1"))).status).toBe(400);
    h.observations.push(makeObs());
    expect((await exportPOST(jsonReq({ dateFrom: "not-a-date" }), p("1"))).status).toBe(400);
    expect(
      (await exportPOST(jsonReq({ observationIds: ["7"] }), p("1"))).status
    ).toBe(400);
    h.authOk = false;
    expect((await exportPOST(jsonReq({}), p("1"))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sidecar 429 and timeout surface as SSE error events; no export row", async () => {
    h.observations.push(makeObs());
    fetchMock.mockResolvedValueOnce(new Response("busy", { status: 429 }));
    let events = await readSse(await exportPOST(jsonReq({}), p("1")));
    expect(events.at(-1)?.event).toBe("error");
    expect(String(events.at(-1)?.data.message)).toMatch(/already rendering/);

    const timeoutErr = new Error("timed out");
    timeoutErr.name = "TimeoutError";
    fetchMock.mockRejectedValueOnce(timeoutErr);
    events = await readSse(await exportPOST(jsonReq({}), p("1")));
    expect(String(events.at(-1)?.data.message)).toMatch(/timed out/i);
    expect(h.exports).toHaveLength(0);
  });
});

describe("GET export download", () => {
  async function seedExport(): Promise<string> {
    h.observations.push(makeObs());
    const events = await readSse(await exportPOST(jsonReq({}), p("1")));
    return String((events.at(-1)!.data as { exportId: string }).exportId);
  }

  test("serves the stored PDF with the private-download header policy", async () => {
    const exportId = await seedExport();
    const res = await downloadGET(new Request("http://test/x"), pd("1", exportId));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="consultant-stream-\d{4}-\d{2}-\d{2}\.pdf"$/
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(PDF)).toBe(true);
  });

  test("cross-project → 404; unknown export → 404; unauthenticated → 401", async () => {
    const exportId = await seedExport();
    expect((await downloadGET(new Request("http://test/x"), pd("2", exportId))).status).toBe(404);
    expect((await downloadGET(new Request("http://test/x"), pd("1", "nope"))).status).toBe(404);
    h.authOk = false;
    expect((await downloadGET(new Request("http://test/x"), pd("1", exportId))).status).toBe(401);
  });
});
