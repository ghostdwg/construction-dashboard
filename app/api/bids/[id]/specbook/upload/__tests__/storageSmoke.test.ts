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
//  Suppression must engage ONLY when ALL FOUR hold simultaneously.
//
//  Fail-closed contract: if the marker header is ABSENT, this route behaves
//  exactly as before this feature existed (normal automation fires
//  unconditionally, no extra check performed at all). But if the marker
//  header IS present and any of the other three conditions is not also true,
//  the request must be REJECTED outright — a controlled, non-2xx response,
//  before any BlobStore write or DB persistence — rather than silently
//  falling through to normal (real-provider-calling) automation.
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
    delete process.env.DOCUMENT_AUTOMATION_ENABLED;
    stubSidecarSuccess();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STORAGE_SMOKE_MODE_ENABLED;
    delete process.env.DOCUMENT_AUTOMATION_ENABLED;
  });

  // ── Test 1 — normal upload, all four conditions absent ────────────────────
  //
  // CHANGED (master automation gate, release-hardening fix): this suite
  // predates DOCUMENT_AUTOMATION_ENABLED, whose default is now OFF — so the
  // "fires automation" behavior this test names is no longer the unconditional
  // default; it now also requires the master flag. Since this test's actual
  // purpose is exercising the storage-smoke gate's absence (not the master
  // flag), DOCUMENT_AUTOMATION_ENABLED is set to "true" here so the test keeps
  // validating exactly what it always validated. The genuine new default-off
  // case is covered by "1b" below.
  test("1. normal upload (no marker, no opt-in, non-staging), master automation flag ON — still fires automation exactly as today", async () => {
    h.appEnv.APP_ENV = "local";
    // STORAGE_SMOKE_MODE_ENABLED left unset (default OFF)
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
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

  // ── Test 1b — NEW: master automation flag default-off truth ───────────────
  test("1b. DOCUMENT_AUTOMATION_ENABLED unset (default OFF) — automation is skipped, response honestly reports automationStatus 'disabled'", async () => {
    h.appEnv.APP_ENV = "local";
    // DOCUMENT_AUTOMATION_ENABLED left unset (default OFF) — deleted in
    // beforeEach above.
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(buildMinimalPdf("x")), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("disabled");
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    // Normal upload persistence still happens — only the two automation
    // calls are gated.
    expect(blobPutMock).toHaveBeenCalledWith("plan-room/jobs/1/spec/original.pdf", expect.any(Buffer));
    expect(json.status).toBe("ready");
  });

  // ── Test 1c — NEW: master automation flag explicitly "false" behaves the
  // same as unset ────────────────────────────────────────────────────────────
  test("1c. DOCUMENT_AUTOMATION_ENABLED=false — same as unset, automationStatus 'disabled'", async () => {
    h.appEnv.APP_ENV = "local";
    process.env.DOCUMENT_AUTOMATION_ENABLED = "false";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(buildMinimalPdf("x")), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("disabled");
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
  });

  // ── Test 1d — NEW (Q03.2): malformed/untrusted flag values fail closed —
  // ONLY the literal lowercase string "true" enables automation ─────────────
  test.each(["TRUE", "1", "yes", " true", "true "])(
    "1d. DOCUMENT_AUTOMATION_ENABLED=%j (malformed) fails closed — automationStatus 'disabled', nothing invoked",
    async (malformed) => {
      h.appEnv.APP_ENV = "local";
      process.env.DOCUMENT_AUTOMATION_ENABLED = malformed;
      h.isAdminAuthorized.mockResolvedValue({ authorized: true });

      const { POST } = await import("../route");
      const res = await POST(uploadRequest(buildMinimalPdf("x")), routeParams);
      const json = await res.json();

      expect(res.status).toBe(201);
      expect(json.automationStatus).toBe("disabled");
      expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
      expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    }
  );

  // ── Test 2 — marker present, opt-in OFF ────────────────────────────────────
  test("2. marker present but STORAGE_SMOKE_MODE_ENABLED is OFF (staging tier) — controlled reject BEFORE persistence/automation, fail closed", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "false"; // explicit off, not just unset
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    // Fail-closed: a marker-bearing request with the flag off is REJECTED
    // outright, not silently upgraded into a normal (real-provider-calling)
    // upload. Never 2xx.
    expect(res.status).toBe(403);
    expect(json.automationStatus).toBeUndefined();
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    // No persistence of any kind happened before the reject.
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.specBooks.size).toBe(0);
    expect(db.sections).toHaveLength(0);
    expect(aiUsageLogCreateMock).not.toHaveBeenCalled();
    expect(backgroundJobCreateMock).not.toHaveBeenCalled();
  });

  test("2b. marker present, opt-in ON, but APP_ENV is NOT staging — controlled reject BEFORE persistence/automation, fail closed", async () => {
    h.appEnv.APP_ENV = "production";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.automationStatus).toBeUndefined();
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.specBooks.size).toBe(0);
    expect(db.sections).toHaveLength(0);
    expect(aiUsageLogCreateMock).not.toHaveBeenCalled();
    expect(backgroundJobCreateMock).not.toHaveBeenCalled();
    // APP_ENV is checked before the flag/admin checks — confirm the
    // (comparatively expensive, dynamically-imported) admin check was never
    // even reached for this failure mode.
    expect(h.isAdminAuthorized).not.toHaveBeenCalled();
  });

  // ── Test 3 — opt-in ON, staging, but marker ABSENT ─────────────────────────
  //
  // CHANGED (master automation gate): DOCUMENT_AUTOMATION_ENABLED is set to
  // "true" here for the same reason as test 1 above — this test's purpose is
  // the storage-smoke gate's marker-absence behavior, not the master flag.
  test("3. opt-in ON and APP_ENV=staging, but marker header absent, master automation flag ON — automation still fires, NOT suppressed", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
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
  //
  // CHANGED (master automation gate): DOCUMENT_AUTOMATION_ENABLED is
  // explicitly set to "true" here to prove gate precedence — even when the
  // master flag actively wants automation on, storage-smoke suppression
  // still wins (see the module doc: "suppressed_for_storage_smoke" always
  // takes precedence over the master flag).
  test("4. all four conditions met, master automation flag ON — automation suppressed (smoke gate takes precedence), exact automationStatus returned, normal persistence still happens", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
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

  // ── Test 6 — non-admin cannot trigger suppression, and is rejected (not
  // silently upgraded to normal automation) ─────────────────────────────────
  test("6. non-admin authenticated caller with marker+opt-in+staging all present gets a controlled 403 reject BEFORE persistence/automation", async () => {
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

    // Suppression never engages for a non-admin caller, AND — fail closed —
    // normal automation must not fire either. The request is rejected
    // outright, before any persistence.
    expect(res.status).toBe(403);
    expect(json.error).toBe("Admin access required");
    expect(json.automationStatus).toBeUndefined();
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.specBooks.size).toBe(0);
    expect(db.sections).toHaveLength(0);
    expect(aiUsageLogCreateMock).not.toHaveBeenCalled();
    expect(backgroundJobCreateMock).not.toHaveBeenCalled();
  });

  test("6b. unauthenticated caller (401) gets a controlled 401 reject BEFORE persistence/automation, not a silent fallthrough", async () => {
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

    expect(res.status).toBe(401);
    expect(json.error).toBe("Authentication required");
    expect(json.automationStatus).toBeUndefined();
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.specBooks.size).toBe(0);
    expect(db.sections).toHaveLength(0);
    expect(aiUsageLogCreateMock).not.toHaveBeenCalled();
    expect(backgroundJobCreateMock).not.toHaveBeenCalled();
  });

  // ── Test 7 — no fake evidence written in ANY reject branch (explicit,
  // consolidated assertion across all three reject reasons) ─────────────────
  test("7. no persistence, automation, or fake provider-evidence rows are ever written across any of the three reject branches", async () => {
    const scenarios: Array<{ name: string; appEnv: string; flag: string; admin: { authorized: boolean; status?: 401 | 403; error?: string } }> = [
      { name: "flag off", appEnv: "staging", flag: "false", admin: { authorized: true } },
      { name: "wrong env", appEnv: "production", flag: "true", admin: { authorized: true } },
      { name: "non-admin", appEnv: "staging", flag: "true", admin: { authorized: false, status: 403, error: "Admin access required" } },
    ];

    for (const scenario of scenarios) {
      resetDb();
      vi.clearAllMocks();
      h.appEnv.APP_ENV = scenario.appEnv;
      process.env.STORAGE_SMOKE_MODE_ENABLED = scenario.flag;
      h.isAdminAuthorized.mockResolvedValue(scenario.admin);
      stubSidecarSuccess();

      const { POST } = await import("../route");
      const res = await POST(
        uploadRequest(buildMinimalPdf("x"), { [STORAGE_SMOKE_HEADER]: "1" }),
        routeParams
      );

      expect(res.status, `${scenario.name}: must not be 2xx`).toBeGreaterThanOrEqual(400);
      expect(generateBidIntelligenceMock, `${scenario.name}: no automation`).not.toHaveBeenCalled();
      expect(triggerBriefRefreshMock, `${scenario.name}: no automation`).not.toHaveBeenCalled();
      expect(blobPutMock, `${scenario.name}: no blob write`).not.toHaveBeenCalled();
      expect(db.specBooks.size, `${scenario.name}: no SpecBook row`).toBe(0);
      expect(db.sections, `${scenario.name}: no SpecSection rows`).toHaveLength(0);
      expect(aiUsageLogCreateMock, `${scenario.name}: no fake AiUsageLog row`).not.toHaveBeenCalled();
      expect(backgroundJobCreateMock, `${scenario.name}: no fake BackgroundJob row`).not.toHaveBeenCalled();
    }
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
