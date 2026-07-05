// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/specbook/upload/__tests__/storageSmoke.test.ts
//
//  Work package: specbook-storage-smoke-isolation.
//
//  Coverage for the 4-condition storage-only suppression gate added to
//  POST /api/bids/[id]/specbook/upload:
//
//    a. Authenticated ADMIN session (lib/auth.ts's isAdminAuthorized())
//    b. Non-secret intent marker header (X-Specbook-Storage-Smoke: 1)
//    c. STORAGE_SMOKE_MODE_ENABLED=true (server-side opt-in, defaults OFF)
//    d. env.APP_ENV === "staging" (server-side identity fact, Zod-validated
//       at boot in lib/env.ts, never derived from any part of a request)
//
//  Suppression must engage ONLY when ALL FOUR hold simultaneously. Missing
//  any single one must leave normal automation (generateBidIntelligence +
//  triggerBriefRefresh) firing exactly as before this feature existed.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ── Hoisted, mutable test doubles ───────────────────────────────────────────
// vi.mock factories run before imports, so mutable state they close over must
// be created via vi.hoisted. h.appEnv is a single stable object reference —
// mutating h.appEnv.APP_ENV between tests changes what the route sees on its
// next `env.APP_ENV` read, without needing vi.resetModules().

const h = vi.hoisted(() => ({
  isAdminAuthorized: vi.fn(),
  appEnv: { APP_ENV: "local" as string },
}));

vi.mock("@/lib/auth", () => ({ isAdminAuthorized: h.isAdminAuthorized }));
vi.mock("@/lib/env", () => ({ env: h.appEnv }));

// ── Prisma mock — same shape as the sibling route.test.ts ───────────────────

type SpecBookRow = { id: number; bidId: number; fileName: string; filePath: string; status: string };
type SpecSectionRow = {
  specBookId: number;
  csiNumber: string;
  csiTitle: string;
  rawText: string;
  tradeId: number | null;
  matchedTradeId: number | null;
  covered: boolean;
};

const db = {
  bidExists: true,
  trades: [{ id: 10, csiCode: "03 30 00" }] as Array<{ id: number; csiCode: string | null }>,
  bidTrades: [{ tradeId: 10 }] as Array<{ tradeId: number }>,
  specBooks: new Map<number, SpecBookRow>(),
  specBookCounter: 0,
  sections: [] as SpecSectionRow[],
};

function resetDb() {
  db.bidExists = true;
  db.specBooks.clear();
  db.specBookCounter = 0;
  db.sections = [];
  blobData.clear();
}

// Standalone spies so test #5 can assert zero fake provider-evidence rows are
// ever written for the suppressed path — these are never invoked by the
// mocked generateBidIntelligence/triggerBriefRefresh below (those are fully
// stubbed out, not delegated to), so a passing assertion here is equivalent
// to proving no AiUsageLog/BackgroundJob row was created.
const aiUsageLogCreateMock = vi.fn(async () => ({ id: "fake" }));
const backgroundJobCreateMock = vi.fn(async () => ({ id: "fake" }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bid: {
      findUnique: vi.fn(async () => (db.bidExists ? { id: 1 } : null)),
    },
    trade: {
      findMany: vi.fn(async () => db.trades),
    },
    bidTrade: {
      findMany: vi.fn(async () => db.bidTrades),
    },
    specBook: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Omit<SpecBookRow, "id"> }) => {
        db.specBookCounter += 1;
        const row: SpecBookRow = { id: db.specBookCounter, ...data };
        db.specBooks.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<SpecBookRow> }) => {
        const row = db.specBooks.get(where.id);
        if (!row) throw new Error("SpecBook not found");
        Object.assign(row, data);
        return { ...row, _count: { sections: db.sections.filter((s) => s.specBookId === where.id).length } };
      }),
    },
    specSection: {
      createMany: vi.fn(async ({ data }: { data: SpecSectionRow[] }) => {
        db.sections.push(...data);
        return { count: data.length };
      }),
      count: vi.fn(async ({ where }: { where: { specBookId: number; covered: boolean } }) =>
        db.sections.filter((s) => s.specBookId === where.specBookId && s.covered === where.covered).length
      ),
    },
    // Never touched by this route directly — present only so test #5 can
    // assert these specific write paths were never reached transitively.
    aiUsageLog: { create: aiUsageLogCreateMock },
    backgroundJob: { create: backgroundJobCreateMock },
  },
}));

// ── AI/provider side-effect mocks — the exact fire-and-forget calls this
// feature must be able to suppress ─────────────────────────────────────────

const generateBidIntelligenceMock = vi.fn(async () => ({ findingCount: 0, coverage: 0 }));
vi.mock("@/app/api/bids/[id]/intelligence/generate/route", () => ({
  generateBidIntelligence: generateBidIntelligenceMock,
}));

const triggerBriefRefreshMock = vi.fn(async () => undefined);
vi.mock("@/lib/services/jobs/briefRefreshAutomation", () => ({
  triggerBriefRefresh: triggerBriefRefreshMock,
}));

// ── BlobStore mock — in-memory, hermetic ────────────────────────────────────

const blobData = new Map<string, Buffer>();
const blobPutMock = vi.fn(async (key: string, data: Buffer) => {
  blobData.set(key, data);
  return { size: data.length, sha256: "fake-sha", storedAt: "2026-01-01T00:00:00.000Z" };
});
vi.mock("@/lib/storage/blobStore", () => ({
  getBlobStore: () => ({
    put: blobPutMock,
    get: vi.fn(async (key: string) => {
      const buf = blobData.get(key);
      if (!buf) throw new Error("BlobStore: not found");
      return buf;
    }),
    exists: vi.fn(async (key: string) => blobData.has(key)),
    delete: vi.fn(async (key: string) => {
      blobData.delete(key);
    }),
    stat: vi.fn(async () => null),
  }),
  localPathForKey: vi.fn((key: string) => `/storage/${key}`),
}));

// ── Minimal synthetic PDF (byte-exact xref offsets), matching the sibling
// route.test.ts's fixture builder ───────────────────────────────────────────

function buildMinimalPdf(text: string): Buffer {
  const header = "%PDF-1.4\n";
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    `5 0 obj\n<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream\nendobj\n`,
  ];

  let body = header;
  const offsets: number[] = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += obj;
  }

  const xrefOffset = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body + xref + trailer, "latin1");
}

function uploadRequest(buffer: Buffer, headers?: Record<string, string>) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buffer)], "specbook.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/api/bids/1/specbook/upload", {
    method: "POST",
    body: form,
    headers,
  });
}

const routeParams = { params: Promise.resolve({ id: "1" }) };
const STORAGE_SMOKE_HEADER = "x-specbook-storage-smoke";

// Sidecar success stub — every test uses this so parse behavior itself is
// never the variable under test here (that's covered by route.test.ts).
function stubSidecarSuccess() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(
        JSON.stringify({
          sections: [
            {
              section_number: "03 30 00",
              title: "CAST-IN-PLACE CONCRETE",
              raw_text: "from sidecar",
              page_start: 1,
              page_end: 1,
              table_count: 0,
              page_count: 1,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    )
  );
}

describe("POST /api/bids/[id]/specbook/upload — storage-only smoke suppression", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    h.appEnv.APP_ENV = "local";
    delete process.env.STORAGE_SMOKE_MODE_ENABLED;
    stubSidecarSuccess();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STORAGE_SMOKE_MODE_ENABLED;
  });

  // ── Test 1 — normal upload, all four conditions absent ────────────────────
  test("1. normal upload (no marker, no opt-in, non-staging) still fires automation exactly as today", async () => {
    h.appEnv.APP_ENV = "local";
    // STORAGE_SMOKE_MODE_ENABLED left unset (default OFF)
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(buildMinimalPdf("x")), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("triggered");
    expect(generateBidIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
    // isAdminAuthorized is never even consulted on the default path — no
    // marker header means the whole gate short-circuits before the auth
    // check, so it must not have been called.
    expect(h.isAdminAuthorized).not.toHaveBeenCalled();
  });

  // ── Test 2 — marker present, opt-in OFF ────────────────────────────────────
  test("2. marker present but STORAGE_SMOKE_MODE_ENABLED is OFF (staging tier) — automation still fires, NOT suppressed", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "false"; // explicit off, not just unset
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("triggered");
    expect(generateBidIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
  });

  test("2b. marker present, opt-in ON, but APP_ENV is NOT staging — automation still fires, NOT suppressed", async () => {
    h.appEnv.APP_ENV = "production";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("triggered");
    expect(generateBidIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
  });

  // ── Test 3 — opt-in ON, staging, but marker ABSENT ─────────────────────────
  test("3. opt-in ON and APP_ENV=staging, but marker header absent — automation still fires, NOT suppressed", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(buildMinimalPdf("x")), routeParams); // no header
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("triggered");
    expect(generateBidIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
    // The gate's non-auth conditions were satisfiable, but no marker means
    // isAdminAuthorized is never reached.
    expect(h.isAdminAuthorized).not.toHaveBeenCalled();
  });

  // ── Test 4 — ALL FOUR conditions met ───────────────────────────────────────
  test("4. all four conditions met — automation suppressed, exact automationStatus returned, normal persistence still happens", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("suppressed_for_storage_smoke");
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();

    // Normal upload persistence + sidecar parse/split still happened exactly
    // as a non-suppressed run would — suppression only touches the two
    // automation calls, nothing else about the upload flow.
    expect(blobPutMock).toHaveBeenCalledWith("plan-room/jobs/1/spec/original.pdf", expect.any(Buffer));
    expect(db.sections).toHaveLength(1);
    expect(db.sections[0].rawText).toBe("from sidecar");
    expect(json.coveredCount).toBe(1);
    expect(json.status).toBe("ready");
  });

  // ── Test 5 — no fake provider evidence in suppressed mode ─────────────────
  test("5. no fake AiUsageLog/BackgroundJob evidence is written when suppressed", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    expect(res.status).toBe(201);

    // The only two code paths in this app that ever create AiUsageLog /
    // BackgroundJob rows for this flow are generateBidIntelligence (via
    // logAiUsage) and triggerBriefRefresh (via createJob/completeJob) — both
    // fully mocked out above. Proving they were never called IS proof no
    // such row could have been created. The direct prisma spies below back
    // this up as a second, independent check.
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(aiUsageLogCreateMock).not.toHaveBeenCalled();
    expect(backgroundJobCreateMock).not.toHaveBeenCalled();
  });

  // ── Test 6 — non-admin cannot trigger suppression ──────────────────────────
  test("6. non-admin authenticated caller cannot trigger suppression even with marker+opt-in+staging all present", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "Admin access required",
    });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    // Normal automation still fires — suppression never engages for a
    // non-admin caller, regardless of the other three conditions.
    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("triggered");
    expect(generateBidIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
  });

  test("6b. unauthenticated caller (401) cannot trigger suppression either", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Authentication required",
    });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("triggered");
    expect(generateBidIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
  });

  // ── Test 9 — full-shape sweep: no secret/content/marker-value leakage ─────
  test("9. suppressed-mode response/log/error surfaces never contain credential, document content, or the marker header's value", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const secretMarkerValue = "1"; // the only value this header is ever sent with
    const documentText = "from sidecar"; // synthetic sidecar text used as a stand-in for "content"
    const fakeCredential = "sk-ant-should-never-appear-anywhere";
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = fakeCredential;

    try {
      const { POST } = await import("../route");
      const res = await POST(
        uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: secretMarkerValue }),
        routeParams
      );
      const json = await res.json();
      const responseText = JSON.stringify(json);

      // The response body itself.
      expect(responseText).not.toContain(fakeCredential);
      expect(responseText).not.toContain(documentText);
      // The header's own name is fine to reference in code, but its VALUE
      // (bare "1") must never surface tagged as a marker/credential — since
      // "1" alone is too ambiguous to assert against usefully, instead
      // assert the header name itself never leaks (it should never need to
      // be echoed back).
      expect(responseText.toLowerCase()).not.toContain(STORAGE_SMOKE_HEADER);

      // Every console.log/error/warn call across the whole request.
      const allLoggedArgs = [...consoleLogSpy.mock.calls, ...consoleErrorSpy.mock.calls, ...consoleWarnSpy.mock.calls]
        .flat()
        .map((a) => (typeof a === "string" ? a : JSON.stringify(a)));

      for (const line of allLoggedArgs) {
        expect(line).not.toContain(fakeCredential);
        expect(line.toLowerCase()).not.toContain(STORAGE_SMOKE_HEADER);
      }
    } finally {
      process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    }
  });
});
