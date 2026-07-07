// ──────────────────────────────────────────────────────────────────────────────
//  app/api/bids/[id]/addendums/[addendumId]/__tests__/storageSmoke.test.ts
//
//  Work package: storage-smoke-isolation (addendums DELETE — captain's
//  cross-track ruling extending GWX-Q06a).
//
//  Coverage for the 4-condition storage-only suppression gate added to
//  DELETE /api/bids/[id]/addendums/[addendumId] — IDENTICAL semantics to the
//  Spec Book / Drawings upload gates, only the marker header name differs
//  (domain-scoped: X-Addendums-Storage-Smoke):
//
//    a. Authenticated ADMIN session (lib/auth.ts's isAdminAuthorized())
//    b. Non-secret intent marker header (X-Addendums-Storage-Smoke: 1)
//    c. STORAGE_SMOKE_MODE_ENABLED=true (server-side opt-in, defaults OFF)
//    d. env.APP_ENV === "staging" (server-side identity fact)
//
//  Suppression must engage ONLY when ALL FOUR hold simultaneously. When it
//  does, the ONLY behavioral changes are: triggerBriefRefresh is not called,
//  and the response gains an additive X-Automation-Status:
//  suppressed_for_storage_smoke header. The delete itself, the blob cleanup,
//  the brief-stale marking, and the 200 { deleted: true } success body are
//  all unchanged.
//
//  Fail-closed contract: if the marker header is ABSENT, this route behaves
//  exactly as before this feature existed (delete proceeds, refresh fires,
//  no X-Automation-Status header — byte-identical response). But if the
//  marker header IS present and any of the other three conditions is not
//  also true, the request must be REJECTED outright — a controlled, non-2xx
//  response, BEFORE the row lookup/delete/blob cleanup — rather than
//  silently falling through to a normal delete whose side effect is a real
//  provider call.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  isAdminAuthorized: vi.fn(),
  appEnv: { APP_ENV: "local" as string },
  // Q03.2b: the persisted Admin "Document AI Enrichment" setting — null =
  // no AppSetting row (DB default OFF); a string = the row's stored value.
  adminAutomation: { value: null as string | null },
}));

vi.mock("@/lib/auth", () => ({ isAdminAuthorized: h.isAdminAuthorized }));
vi.mock("@/lib/env", () => ({ env: h.appEnv }));

type AddendumRow = { id: number; bidId: number; storageKey: string | null };

const db = {
  record: null as AddendumRow | null,
  deletedId: null as number | null,
  briefUpdateManyArgs: null as unknown,
};

function resetDb() {
  db.record = { id: 31, bidId: 31, storageKey: null };
  db.deletedId = null;
  db.briefUpdateManyArgs = null;
}

const findUniqueMock = vi.fn(async () => db.record);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(async () =>
        h.adminAutomation.value === null
          ? null
          : { id: 1, key: "documentAutomationEnabled", value: h.adminAutomation.value, updatedAt: new Date(0) }
      ),
    },
    addendumUpload: {
      findUnique: findUniqueMock,
      delete: vi.fn(async ({ where }: { where: { id: number } }) => {
        db.deletedId = where.id;
        return { id: where.id };
      }),
    },
    bidIntelligenceBrief: {
      updateMany: vi.fn(async (args: unknown) => {
        db.briefUpdateManyArgs = args;
        return { count: 0 };
      }),
    },
  },
}));

const triggerBriefRefreshMock = vi.fn(async () => undefined);
vi.mock("@/lib/services/jobs/briefRefreshAutomation", () => ({
  triggerBriefRefresh: triggerBriefRefreshMock,
}));

const deleteAddendumStoragePathMock = vi.fn(async () => undefined);
vi.mock("@/lib/services/addendums/storagePath", () => ({
  deleteAddendumStoragePath: deleteAddendumStoragePathMock,
}));

function deleteRequest(headers?: Record<string, string>) {
  return new Request("http://localhost/api/bids/31/addendums/31", {
    method: "DELETE",
    headers,
  });
}

const routeParams = { params: Promise.resolve({ id: "31", addendumId: "31" }) };
const STORAGE_SMOKE_HEADER = "x-addendums-storage-smoke";

describe("DELETE /api/bids/[id]/addendums/[addendumId] — storage-only smoke suppression", () => {
  beforeEach(() => {
    resetDb();
    vi.clearAllMocks();
    h.appEnv.APP_ENV = "local";
    delete process.env.STORAGE_SMOKE_MODE_ENABLED;
    h.adminAutomation.value = null; delete process.env.DOCUMENT_AUTOMATION_ENABLED; delete process.env.DOCUMENT_AUTOMATION_HARD_DISABLED;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STORAGE_SMOKE_MODE_ENABLED;
    h.adminAutomation.value = null; delete process.env.DOCUMENT_AUTOMATION_ENABLED; delete process.env.DOCUMENT_AUTOMATION_HARD_DISABLED;
  });

  // ── Test 1 — normal delete, all four conditions absent ────────────────────
  //
  // CHANGED (master automation gate, release-hardening fix): this suite
  // predates DOCUMENT_AUTOMATION_ENABLED, whose default is now OFF — so
  // "fires the brief refresh" is no longer the unconditional default; it now
  // also requires the master flag. This test's actual purpose is exercising
  // the storage-smoke gate's absence, so DOCUMENT_AUTOMATION_ENABLED is set
  // to "true" here to keep validating exactly what it always validated. The
  // genuine new default-off case is covered by "1b" below.
  test("1. normal delete (no marker, no opt-in, non-staging), master automation flag ON — still fires the brief refresh exactly as today, response byte-identical (no X-Automation-Status header)", async () => {
    h.appEnv.APP_ENV = "local";
    h.adminAutomation.value = "true"; // Admin setting ON (persisted)
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ deleted: true });
    expect(res.headers.get("X-Automation-Status")).toBeNull();
    expect(db.deletedId).toBe(31);
    expect(db.briefUpdateManyArgs).toEqual({ where: { bidId: 31 }, data: { isStale: true } });
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
    expect(triggerBriefRefreshMock).toHaveBeenCalledWith(31, { triggerSource: "upload" });
    // isAdminAuthorized is never even consulted on the default path.
    expect(h.isAdminAuthorized).not.toHaveBeenCalled();
  });

  // ── Test 1b — NEW: master automation flag default-off truth ───────────────
  test("1b. Admin setting absent (DB default OFF) — refresh is skipped, response honestly carries X-Automation-Status: disabled, delete/blob-cleanup/stale-marking still happen", async () => {
    h.appEnv.APP_ENV = "local";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ deleted: true }); // body shape unchanged
    expect(res.headers.get("X-Automation-Status")).toBe("disabled");
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    // Delete + brief-stale marking still happen — only the refresh call is
    // gated.
    expect(db.deletedId).toBe(31);
    expect(db.briefUpdateManyArgs).toEqual({ where: { bidId: 31 }, data: { isStale: true } });
  });

  // ── Test 1c — NEW: master automation flag explicitly "false" behaves the
  // same as unset ────────────────────────────────────────────────────────────
  test("1c. Admin setting persisted \"false\" — same as unset, X-Automation-Status: disabled", async () => {
    h.appEnv.APP_ENV = "local";
    h.adminAutomation.value = "false";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest(), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ deleted: true });
    expect(res.headers.get("X-Automation-Status")).toBe("disabled");
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
  });

  // ── Test 1d — NEW (Q03.2): malformed/untrusted flag values fail closed —
  // ONLY the literal lowercase string "true" enables automation ─────────────
  test.each(["TRUE", "1", "yes", " true", "true "])(
    "1d. persisted Admin value %j (malformed) fails closed — X-Automation-Status 'disabled', refresh not invoked",
    async (malformed) => {
      h.appEnv.APP_ENV = "local";
      h.adminAutomation.value = malformed;
      h.isAdminAuthorized.mockResolvedValue({ authorized: true });

      const { DELETE } = await import("../route");
      const res = await DELETE(deleteRequest(), routeParams);
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json).toEqual({ deleted: true });
      expect(res.headers.get("X-Automation-Status")).toBe("disabled");
      expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    }
  );

  // ── Test 1e — emergency hard-disable lock (exact-literal semantics) ────────
  test("1e. DOCUMENT_AUTOMATION_HARD_DISABLED=true overrides Admin ON — X-Automation-Status 'hard_disabled', refresh not invoked; malformed lock values do NOT engage the lock", async () => {
    h.appEnv.APP_ENV = "local";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });
    h.adminAutomation.value = "true"; // Admin setting ON

    process.env.DOCUMENT_AUTOMATION_HARD_DISABLED = "true"; // exact literal engages the lock
    const { DELETE } = await import("../route");
    let res = await DELETE(deleteRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(res.headers.get("X-Automation-Status")).toBe("hard_disabled");
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();

    process.env.DOCUMENT_AUTOMATION_HARD_DISABLED = "TRUE"; // malformed — lock NOT engaged; Admin ON governs
    res = await DELETE(deleteRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(res.headers.get("X-Automation-Status")).toBeNull(); // triggered path adds no header
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
  });

  // ── Test 1f — legacy env flag is not a side-door ────────────────────────────
  test("1f. legacy DOCUMENT_AUTOMATION_ENABLED=true cannot enable automation — Admin setting absent still yields X-Automation-Status 'disabled'", async () => {
    h.appEnv.APP_ENV = "local";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true"; // legacy flag — read nowhere
    // h.adminAutomation.value stays null: no persisted row (DB default OFF)

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest(), routeParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(res.headers.get("X-Automation-Status")).toBe("disabled");
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
  });

  // ── Test 2 — marker present, opt-in OFF ────────────────────────────────────
  test("2. marker present but STORAGE_SMOKE_MODE_ENABLED is OFF (staging tier) — controlled reject BEFORE the delete/automation, fail closed", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "false"; // explicit off, not just unset
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest({ [STORAGE_SMOKE_HEADER]: "1" }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.deleted).toBeUndefined();
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    // No row lookup, no delete, no blob cleanup, no brief-stale write.
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(db.deletedId).toBeNull();
    expect(deleteAddendumStoragePathMock).not.toHaveBeenCalled();
    expect(db.briefUpdateManyArgs).toBeNull();
  });

  test("2b. marker present, opt-in ON, but APP_ENV is NOT staging — controlled reject BEFORE the delete/automation, fail closed", async () => {
    h.appEnv.APP_ENV = "production";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest({ [STORAGE_SMOKE_HEADER]: "1" }), routeParams);

    expect(res.status).toBe(403);
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(db.deletedId).toBeNull();
    expect(deleteAddendumStoragePathMock).not.toHaveBeenCalled();
    expect(db.briefUpdateManyArgs).toBeNull();
    // APP_ENV is checked before the flag/admin checks — the (comparatively
    // expensive, dynamically-imported) admin check was never even reached.
    expect(h.isAdminAuthorized).not.toHaveBeenCalled();
  });

  // ── Test 3 — opt-in ON, staging, but marker ABSENT ─────────────────────────
  //
  // CHANGED (master automation gate): DOCUMENT_AUTOMATION_ENABLED set to
  // "true" for the same reason as test 1 above.
  test("3. opt-in ON and APP_ENV=staging, but marker header absent, master automation flag ON — refresh still fires, NOT suppressed, response unchanged", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.adminAutomation.value = "true"; // Admin setting ON (persisted)
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest(), routeParams); // no header
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ deleted: true });
    expect(res.headers.get("X-Automation-Status")).toBeNull();
    expect(triggerBriefRefreshMock).toHaveBeenCalledTimes(1);
    expect(h.isAdminAuthorized).not.toHaveBeenCalled();
  });

  // ── Test 4 — ALL FOUR conditions met ───────────────────────────────────────
  //
  // CHANGED (master automation gate): DOCUMENT_AUTOMATION_ENABLED explicitly
  // "true" to prove gate precedence — storage-smoke suppression still wins.
  test("4. all four conditions met, master automation flag ON — refresh suppressed (smoke gate takes precedence), X-Automation-Status header set, delete/blob-cleanup/stale-marking still happen, success body unchanged", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.adminAutomation.value = "true"; // Admin setting ON (persisted)
    h.isAdminAuthorized.mockResolvedValue({ authorized: true });
    db.record = { id: 31, bidId: 31, storageKey: "uploads/addendums/31/a.pdf" };

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest({ [STORAGE_SMOKE_HEADER]: "1" }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ deleted: true }); // body shape unchanged
    expect(res.headers.get("X-Automation-Status")).toBe("suppressed_for_storage_smoke");
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();

    // Everything else about the delete flow ran exactly as a non-suppressed
    // run would — suppression only touches the one provider-bound call.
    expect(db.deletedId).toBe(31);
    expect(deleteAddendumStoragePathMock).toHaveBeenCalledWith("uploads/addendums/31/a.pdf", 31);
    expect(db.briefUpdateManyArgs).toEqual({ where: { bidId: 31 }, data: { isStale: true } });
  });

  // ── Test 5 — non-admin cannot trigger suppression, and is rejected (not
  // silently upgraded to a normal, provider-calling delete) ─────────────────
  test("5. non-admin authenticated caller with marker+opt-in+staging all present gets a controlled 403 reject BEFORE the delete/automation", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({
      authorized: false,
      status: 403,
      error: "Admin access required",
    });

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest({ [STORAGE_SMOKE_HEADER]: "1" }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe("Admin access required");
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(db.deletedId).toBeNull();
    expect(deleteAddendumStoragePathMock).not.toHaveBeenCalled();
    expect(db.briefUpdateManyArgs).toBeNull();
  });

  test("5b. unauthenticated caller (401) gets a controlled 401 reject BEFORE the delete/automation, not a silent fallthrough", async () => {
    h.appEnv.APP_ENV = "staging";
    process.env.STORAGE_SMOKE_MODE_ENABLED = "true";
    h.isAdminAuthorized.mockResolvedValue({
      authorized: false,
      status: 401,
      error: "Authentication required",
    });

    const { DELETE } = await import("../route");
    const res = await DELETE(deleteRequest({ [STORAGE_SMOKE_HEADER]: "1" }), routeParams);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe("Authentication required");
    expect(triggerBriefRefreshMock).not.toHaveBeenCalled();
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(db.deletedId).toBeNull();
    expect(db.briefUpdateManyArgs).toBeNull();
  });

  // ── Test 6 — consolidated reject-branch sweep ──────────────────────────────
  test("6. no delete, automation, or persistence of any kind across all three reject branches", async () => {
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

      const { DELETE } = await import("../route");
      const res = await DELETE(deleteRequest({ [STORAGE_SMOKE_HEADER]: "1" }), routeParams);

      expect(res.status, `${scenario.name}: must not be 2xx`).toBeGreaterThanOrEqual(400);
      expect(triggerBriefRefreshMock, `${scenario.name}: no automation`).not.toHaveBeenCalled();
      expect(findUniqueMock, `${scenario.name}: no row lookup`).not.toHaveBeenCalled();
      expect(db.deletedId, `${scenario.name}: no delete`).toBeNull();
      expect(deleteAddendumStoragePathMock, `${scenario.name}: no blob cleanup`).not.toHaveBeenCalled();
      expect(db.briefUpdateManyArgs, `${scenario.name}: no brief-stale write`).toBeNull();
    }
  });

  // ── Test 7 — the marker header is never persisted/leaked anywhere ─────────
  test("7. suppressed-mode response/log surfaces never contain the marker header's name or a credential", async () => {
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
      const { DELETE } = await import("../route");
      const res = await DELETE(deleteRequest({ [STORAGE_SMOKE_HEADER]: "1" }), routeParams);
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
