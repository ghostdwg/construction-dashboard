// Q03.2b — unit coverage for the Admin-controlled document-automation gate.
//
// Locks the safety hierarchy: persisted Admin setting is the ONLY enabler
// (DB default OFF), DOCUMENT_AUTOMATION_HARD_DISABLED is an exact-literal
// emergency lock that can only force OFF, and the legacy
// DOCUMENT_AUTOMATION_ENABLED env var can never enable anything.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  row: null as { id: number; key: string; value: string; updatedAt: Date } | null,
}));

const findUniqueMock = vi.hoisted(() => vi.fn(async () => h.row));

vi.mock("@/lib/prisma", () => ({
  prisma: { appSetting: { findUnique: findUniqueMock } },
}));

import {
  DOCUMENT_AUTOMATION_SETTING_KEY,
  documentAutomationStatus,
  getDocumentAutomationState,
  isDocumentAutomationHardDisabled,
} from "../documentAutomation";

function setRow(value: string | null) {
  h.row =
    value === null
      ? null
      : { id: 1, key: DOCUMENT_AUTOMATION_SETTING_KEY, value, updatedAt: new Date(0) };
}

beforeEach(() => {
  setRow(null);
  findUniqueMock.mockClear();
  delete process.env.DOCUMENT_AUTOMATION_HARD_DISABLED;
  delete process.env.DOCUMENT_AUTOMATION_ENABLED;
});

afterEach(() => {
  delete process.env.DOCUMENT_AUTOMATION_HARD_DISABLED;
  delete process.env.DOCUMENT_AUTOMATION_ENABLED;
});

describe("documentAutomation — persisted Admin gate", () => {
  test("a) database default is OFF: no AppSetting row => disabled, effective false", async () => {
    const state = await getDocumentAutomationState();
    expect(state.adminEnabled).toBe(false);
    expect(state.effectiveEnabled).toBe(false);
    expect(state.updatedAt).toBeNull();
    expect(await documentAutomationStatus()).toBe("disabled");
  });

  test("b) Admin ON (persisted \"true\") => triggered", async () => {
    setRow("true");
    expect(await documentAutomationStatus()).toBe("triggered");
    const state = await getDocumentAutomationState();
    expect(state.adminEnabled).toBe(true);
    expect(state.effectiveEnabled).toBe(true);
    expect(state.updatedAt).toBe(new Date(0).toISOString());
  });

  test("c) Admin OFF blocks: persisted \"false\" or malformed values => disabled", async () => {
    for (const v of ["false", "TRUE", "1", "yes", " true", "true "]) {
      setRow(v);
      expect(await documentAutomationStatus()).toBe("disabled");
    }
  });

  test("d) emergency hard-disable overrides Admin ON (exact literal only)", async () => {
    setRow("true");
    process.env.DOCUMENT_AUTOMATION_HARD_DISABLED = "true";
    expect(isDocumentAutomationHardDisabled()).toBe(true);
    expect(await documentAutomationStatus()).toBe("hard_disabled");
    const state = await getDocumentAutomationState();
    expect(state.adminEnabled).toBe(true);
    expect(state.hardDisabled).toBe(true);
    expect(state.effectiveEnabled).toBe(false);

    // Malformed/absent lock values NEVER engage the lock (and can never
    // enable anything either) — Admin setting governs.
    for (const v of ["TRUE", "1", "false", "yes", ""]) {
      process.env.DOCUMENT_AUTOMATION_HARD_DISABLED = v;
      expect(isDocumentAutomationHardDisabled()).toBe(false);
      expect(await documentAutomationStatus()).toBe("triggered");
    }
    delete process.env.DOCUMENT_AUTOMATION_HARD_DISABLED;
    expect(await documentAutomationStatus()).toBe("triggered");
  });

  test("e) legacy DOCUMENT_AUTOMATION_ENABLED env var can never enable automation", async () => {
    process.env.DOCUMENT_AUTOMATION_ENABLED = "true";
    setRow(null);
    expect(await documentAutomationStatus()).toBe("disabled");
    setRow("false");
    expect(await documentAutomationStatus()).toBe("disabled");
  });

  test("f) settings-lookup failure fails CLOSED: status is 'disabled', never 'triggered'; admin state read still surfaces the error", async () => {
    findUniqueMock.mockRejectedValueOnce(new Error("db unavailable (simulated)"));
    expect(await documentAutomationStatus()).toBe("disabled");
    // Admin-panel read path deliberately still rejects (operators must see
    // the real error, not a fabricated "off").
    findUniqueMock.mockRejectedValueOnce(new Error("db unavailable (simulated)"));
    await expect(getDocumentAutomationState()).rejects.toThrow("db unavailable");
    // Hard-disable lock is env-only and still wins even when the DB is down.
    process.env.DOCUMENT_AUTOMATION_HARD_DISABLED = "true";
    findUniqueMock.mockRejectedValueOnce(new Error("db unavailable (simulated)"));
    expect(await documentAutomationStatus()).toBe("hard_disabled");
  });

  test("freshness: every status check reads the DB (no long-lived cache)", async () => {
    await documentAutomationStatus();
    setRow("true");
    expect(await documentAutomationStatus()).toBe("triggered"); // next call sees the flip
    setRow(null);
    expect(await documentAutomationStatus()).toBe("disabled");
    expect(findUniqueMock).toHaveBeenCalledTimes(3);
  });
});
