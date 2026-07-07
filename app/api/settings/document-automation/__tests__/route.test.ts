// Q03.2b — admin-only read/update route for the global "Document AI
// Enrichment" setting. Locks: (g) unauthorized users can neither read nor
// change the privileged control data; changes are persisted (default OFF),
// cache-coherent, and audited with actor + old/new state + global scope.

import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  isAdminAuthorized: vi.fn(),
  session: null as { user?: { id?: string; email?: string | null } } | null,
  row: null as { id: number; key: string; value: string; updatedAt: Date } | null,
}));

const upsertMock = vi.hoisted(() => vi.fn());
const auditFindFirstMock = vi.hoisted(() => vi.fn(async () => null as unknown));
const emitAuditEventMock = vi.hoisted(() => vi.fn(async () => undefined));
const clearCacheMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  isAdminAuthorized: h.isAdminAuthorized,
  auth: vi.fn(async () => h.session),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(async () => h.row),
      upsert: upsertMock,
    },
    auditEvent: { findFirst: auditFindFirstMock },
  },
}));
vi.mock("@/lib/observability/audit", () => ({ emitAuditEvent: emitAuditEventMock }));
vi.mock("@/lib/services/settings/appSettingsService", () => ({
  clearAppSettingsCache: clearCacheMock,
}));

import { GET, PATCH } from "../route";

function patchRequest(body: unknown): Request {
  return new Request("http://test/api/settings/document-automation", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.row = null;
  h.session = { user: { id: "u1", email: "admin@example.test" } };
  h.isAdminAuthorized.mockResolvedValue({ authorized: true });
  upsertMock.mockImplementation(async ({ create }: { create: { key: string; value: string } }) => {
    h.row = { id: 1, key: create.key, value: create.value, updatedAt: new Date(0) };
    return h.row;
  });
  delete process.env.DOCUMENT_AUTOMATION_HARD_DISABLED;
});

describe("GET/PATCH /api/settings/document-automation", () => {
  test("g) unauthorized: GET is blocked and touches no control data", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: false, status: 401, error: "Authentication required" });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(auditFindFirstMock).not.toHaveBeenCalled();
  });

  test("g) unauthorized: PATCH is blocked, nothing persisted, nothing audited", async () => {
    h.isAdminAuthorized.mockResolvedValue({ authorized: false, status: 403, error: "Admin access required" });
    const res = await PATCH(patchRequest({ enabled: true }));
    expect(res.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
    expect(emitAuditEventMock).not.toHaveBeenCalled();
  });

  test("a) GET default state: no row => adminEnabled false, effective false", async () => {
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.adminEnabled).toBe(false);
    expect(json.effectiveEnabled).toBe(false);
    expect(json.lastChange).toBeNull();
  });

  test("PATCH true persists \"true\", clears the settings cache, audits actor + old/new + global scope", async () => {
    const res = await PATCH(patchRequest({ enabled: true }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "documentAutomationEnabled" },
        create: { key: "documentAutomationEnabled", value: "true" },
        update: { value: "true" },
      })
    );
    expect(clearCacheMock).toHaveBeenCalledTimes(1);
    expect(emitAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "operator_override",
        action: "document_automation_toggle",
        decision: "enabled",
        subject: { kind: "AppSetting", id: "documentAutomationEnabled" },
        actor: expect.objectContaining({ kind: "operator", userId: "u1", email: "admin@example.test" }),
        payload: expect.objectContaining({ scope: "global", from: false, to: true }),
      })
    );
    expect(json.adminEnabled).toBe(true);
    expect(json.effectiveEnabled).toBe(true);
  });

  test("PATCH false disables and audits the transition", async () => {
    h.row = { id: 1, key: "documentAutomationEnabled", value: "true", updatedAt: new Date(0) };
    upsertMock.mockImplementation(async ({ update }: { update: { value: string } }) => {
      h.row = { id: 1, key: "documentAutomationEnabled", value: update.value, updatedAt: new Date(0) };
      return h.row;
    });
    const res = await PATCH(patchRequest({ enabled: false }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(emitAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: "disabled",
        payload: expect.objectContaining({ from: true, to: false }),
      })
    );
    expect(json.adminEnabled).toBe(false);
  });

  test("PATCH rejects non-boolean/malformed bodies with 400 and persists nothing", async () => {
    for (const body of [{ enabled: "true" }, { enabled: 1 }, {}, { enabled: null }]) {
      const res = await PATCH(patchRequest(body));
      expect(res.status).toBe(400);
    }
    expect(upsertMock).not.toHaveBeenCalled();
    expect(emitAuditEventMock).not.toHaveBeenCalled();
  });

  test("GET surfaces the platform safety lock so Admin can explain it", async () => {
    h.row = { id: 1, key: "documentAutomationEnabled", value: "true", updatedAt: new Date(0) };
    process.env.DOCUMENT_AUTOMATION_HARD_DISABLED = "true";
    const res = await GET();
    const json = await res.json();
    expect(json.adminEnabled).toBe(true);
    expect(json.hardDisabled).toBe(true);
    expect(json.effectiveEnabled).toBe(false);
  });
});
