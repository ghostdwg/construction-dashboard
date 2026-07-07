// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/drawings/upload/__tests__/storageSmoke.test.ts
//
//  Work package: storage-smoke-isolation (drawings domain).
//
//  Coverage for the 4-condition storage-only suppression gate added to
//  POST /api/bids/[id]/drawings/upload — IDENTICAL semantics to the Spec Book
//  gate covered by
//  app/api/bids/[id]/specbook/upload/__tests__/storageSmoke.test.ts, only the
//  marker header name differs (domain-scoped: X-Drawings-Storage-Smoke):
//
//    a. Authenticated ADMIN session (lib/auth.ts's isAdminAuthorized())
//    b. Non-secret intent marker header (X-Drawings-Storage-Smoke: 1)
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
//
//  This route has TWO fire-and-forget call sites (the early-return
//  no-sheets-found branch, and the standard parsed-sheets branch) — both must
//  be gated identically. This suite exercises the standard-path call site
//  (via pdfjs text "E-101 Electrical Plan", which the drawing parser matches
//  to discipline E / trade "Electrical" on a FULLSET upload).
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  isAdminAuthorized: vi.fn(),
  appEnv: { APP_ENV: "local" as string },
}));

vi.mock("@/lib/auth", () => ({ isAdminAuthorized: h.isAdminAuthorized }));
vi.mock("@/lib/env", () => ({ env: h.appEnv }));

type DrawingUploadRow = {
  id: number;
  bidId: number;
  fileName: string;
  filePath: string;
  status: string;
  discipline: string;
};

const db = {
  bidExists: true,
  uploads: new Map<number, DrawingUploadRow>(),
  uploadCounter: 0,
  sheets: [] as unknown[],
};

function resetDb() {
  db.bidExists = true;
  db.uploads.clear();
  db.uploadCounter = 0;
  db.sheets = [];
  blobData.clear();
}

// Standalone spies so test #5 can assert zero fake provider-evidence rows are
// ever written for the suppressed path — never invoked by the mocked
// generateBidIntelligence/triggerBriefRefresh below (those are fully stubbed
// out, not delegated to), so a passing assertion here is equivalent to
// proving no AiUsageLog/BackgroundJob row was created.
const aiUsageLogCreateMock = vi.fn(async () => ({ id: "fake" }));
const backgroundJobCreateMock = vi.fn(async () => ({ id: "fake" }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    bid: {
      findUnique: vi.fn(async () => (db.bidExists ? { id: 1 } : null)),
    },
    trade: {
      findMany: vi.fn(async () => [{ id: 10, name: "Electrical" }]),
    },
    bidTrade: {
      findMany: vi.fn(async () => [{ tradeId: 10 }]),
    },
    drawingUpload: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Omit<DrawingUploadRow, "id"> }) => {
        db.uploadCounter += 1;
        const row: DrawingUploadRow = { id: db.uploadCounter, ...data };
        db.uploads.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: number }; data: Partial<DrawingUploadRow> }) => {
        const row = db.uploads.get(where.id);
        if (!row) throw new Error("DrawingUpload not found");
        Object.assign(row, data);
        return row;
      }),
    },
    drawingSheet: {
      createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
        db.sheets.push(...data);
        return { count: data.length };
      }),
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

// pdfjs-dist mocked outright — this route's storage/gate behavior is what's
// under test here, not sheet-number text extraction (covered by
// drawingParser's own unit tests). The stubbed text matches discipline E
// ("Electrical") so the standard (non-early-return) call site is exercised.
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getTextContent: async () => ({ items: [{ str: "E-101 Electrical Plan" }] }),
      }),
    }),
  }),
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
    get: vi.fn(async () => Buffer.from("")),
    exists: vi.fn(async (key: string) => blobData.has(key)),
    delete: vi.fn(async (key: string) => blobData.delete(key)),
    stat: vi.fn(async () => null),
  }),
  localPathForKey: vi.fn((key: string) => `/storage/${key}`),
  safeBlobFileName: (fileName: string) => {
    const base = fileName.split("/").pop()!.trim();
    return base.replace(/[^A-Za-z0-9._() -]/g, "_").slice(0, 180) || "upload.bin";
  },
}));

function uploadRequest(buffer: Buffer, headers?: Record<string, string>) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(buffer)], "drawing.pdf", { type: "application/pdf" }));
  return new Request("http://localhost/api/bids/1/drawings/upload", {
    method: "POST",
    body: form,
    headers,
  });
}

const routeParams = { params: Promise.resolve({ id: "1" }) };
const STORAGE_SMOKE_HEADER = "x-drawings-storage-smoke";

describe("POST /api/bids/[id]/drawings/upload — storage-only smoke suppression", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    h.appEnv.APP_ENV = "local";
    delete process.env.STORAGE_SMOKE_MODE_ENABLED;
    delete process.env.DOCUMENT_AUTOMATION_ENABLED;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STORAGE_SMOKE_MODE_ENABLED;
    delete process.env.DOCUMENT_AUTOMATION_ENABLED;
  });

  // ── Test 1 — normal upload, all four conditions absent ────────────────────
  //
  // CHANGED (master automation gate, release-hardening fix): this suite
  // predates DOCUMENT_AUTOMATION_ENABLED, whose default is now OFF — so
  // "fires automation" is no longer the unconditional default; it now also
  // requires the master flag. This test's actual purpose is exercising the
  // storage-smoke gate's absence, so DOCUMENT_AUTOMATION_ENABLED is set to
  // "true" here to keep validating exactly what it always validated. The
  // genuine new default-off case is covered by "1b" below.
  test("1. normal upload (no marker, no opt-in, non-staging), master automation flag ON — still fires automation exactly as today", async () => {
    h.appEnv.APP_ENV = "local";
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(Buffer.from("%PDF-1.4 fake")), routeParams);
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
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(Buffer.from("%PDF-1.4 fake")), routeParams);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("disabled");
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    // Normal upload persistence still happens — only the two automation
    // calls are gated.
    expect(blobPutMock).toHaveBeenCalledWith("uploads/drawings/1/drawing.pdf", expect.any(Buffer));
  });

  // ── Test 1c — NEW: master automation flag explicitly "false" behaves the
  // same as unset ────────────────────────────────────────────────────────────
  test("1c. DOCUMENT_AUTOMATION_ENABLED=false — same as unset, automationStatus 'disabled'", async () => {
    h.appEnv.APP_ENV = "local";
    process.env.DOCUMENT_AUTOMATION_ENABLED = "false";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(Buffer.from("%PDF-1.4 fake")), routeParams);
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
      const res = await POST(uploadRequest(Buffer.from("%PDF-1.4 fake")), routeParams);
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
      uploadRequest(Buffer.from("%PDF-1.4 fake"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.automationStatus).toBeUndefined();
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.uploads.size).toBe(0);
    expect(db.sheets).toHaveLength(0);
    expect(aiUsageLogCreateMock).not.toHaveBeenCalled();
    expect(backgroundJobCreateMock).not.toHaveBeenCalled();
  });

  test("2b. marker present, opt-in ON, but APP_ENV is NOT staging — controlled reject BEFORE persistence/automation, fail closed", async () => {
    h.appEnv.APP_ENV = "production";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(Buffer.from("%PDF-1.4 fake"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.automationStatus).toBeUndefined();
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.uploads.size).toBe(0);
    expect(db.sheets).toHaveLength(0);
    expect(aiUsageLogCreateMock).not.toHaveBeenCalled();
    expect(backgroundJobCreateMock).not.toHaveBeenCalled();
    // APP_ENV is checked before the flag/admin checks — confirm the
    // (comparatively expensive, dynamically-imported) admin check was never
    // even reached for this failure mode.
    expect(h.isAdminAuthorized).not.toHaveBeenCalled();
  });

  // ── Test 3 — opt-in ON, staging, but marker ABSENT ─────────────────────────
  //
  // CHANGED (master automation gate): DOCUMENT_AUTOMATION_ENABLED set to
  // "true" for the same reason as test 1 above.
  test("3. opt-in ON and APP_ENV=staging, but marker header absent, master automation flag ON — automation still fires, NOT suppressed", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(uploadRequest(Buffer.from("%PDF-1.4 fake")), routeParams); // no header
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("triggered");
    expect(generateBidIntelligenceMock).toHaveBeenCalledTimes(1);
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
    expect(h.isAdminAuthorized).not.toHaveBeenCalled();
  });

  // ── Test 4 — ALL FOUR conditions met ───────────────────────────────────────
  //
  // CHANGED (master automation gate): DOCUMENT_AUTOMATION_ENABLED explicitly
  // "true" to prove gate precedence — storage-smoke suppression still wins.
  test("4. all four conditions met, master automation flag ON — automation suppressed (smoke gate takes precedence), exact automationStatus returned, normal persistence still happens", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(Buffer.from("%PDF-1.4 fake"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.automationStatus).toBe("suppressed_for_storage_smoke");
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();

    // Normal upload persistence + parse still happened exactly as a
    // non-suppressed run would — suppression only touches the two
    // automation calls, nothing else about the upload flow.
    expect(blobPutMock).toHaveBeenCalledWith("uploads/drawings/1/drawing.pdf", expect.any(Buffer));
    expect(db.sheets.length).toBeGreaterThan(0);
    expect(json.coveredCount).toBeGreaterThan(0);
  });

  // ── Test 5 — no fake provider evidence in suppressed mode ─────────────────
  test("5. no fake AiUsageLog/BackgroundJob evidence is written when suppressed", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { POST } = await import("../route");
    const res = await POST(
      uploadRequest(Buffer.from("%PDF-1.4 fake"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    expect(res.status).toBe(201);

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
      uploadRequest(Buffer.from("%PDF-1.4 fake"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe("Admin access required");
    expect(json.automationStatus).toBeUndefined();
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.uploads.size).toBe(0);
    expect(db.sheets).toHaveLength(0);
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
      uploadRequest(Buffer.from("%PDF-1.4 fake"), { [STORAGE_SMOKE_HEADER]: "1" }),
      routeParams
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("Authentication required");
    expect(json.automationStatus).toBeUndefined();
    expect(generateBidIntelligenceMock).not.toHaveBeenCalled();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(blobPutMock).not.toHaveBeenCalled();
    expect(db.uploads.size).toBe(0);
    expect(db.sheets).toHaveLength(0);
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

      const { POST } = await import("../route");
      const res = await POST(
        uploadRequest(Buffer.from("%PDF-1.4 fake"), { [STORAGE_SMOKE_HEADER]: "1" }),
        routeParams
      );

      expect(res.status, `${scenario.name}: must not be 2xx`).toBeGreaterThanOrEqual(400);
      expect(generateBidIntelligenceMock, `${scenario.name}: no automation`).not.toHaveBeenCalled();
      expect(triggerBriefRefreshMock, `${scenario.name}: no automation`).not.toHaveBeenCalled();
      expect(blobPutMock, `${scenario.name}: no blob write`).not.toHaveBeenCalled();
      expect(db.uploads.size, `${scenario.name}: no DrawingUpload row`).toBe(0);
      expect(db.sheets, `${scenario.name}: no DrawingSheet rows`).toHaveLength(0);
      expect(aiUsageLogCreateMock, `${scenario.name}: no fake AiUsageLog row`).not.toHaveBeenCalled();
      expect(backgroundJobCreateMock, `${scenario.name}: no fake BackgroundJob row`).not.toHaveBeenCalled();
    }
  });

  // ── Test 8 — the marker header is never persisted anywhere ───────────────
  test("8. suppressed-mode response/log surfaces never contain the marker header's name or value tagged as such", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const fakeCredential = "sk-ant-should-never-appear-anywhere";
    const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = fakeCredential;

    try {
      const { POST } = await import("../route");
      const res = await POST(
        uploadRequest(Buffer.from("%PDF-1.4 fake"), { [STORAGE_SMOKE_HEADER]: "1" }),
        routeParams
      );
      const json = await res.json();
      const responseText = JSON.stringify(json);

      expect(responseText).not.toContain(fakeCredential);
      expect(responseText.toLowerCase()).not.toContain(STORAGE_SMOKE_HEADER);

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
