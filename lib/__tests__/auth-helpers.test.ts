import { beforeEach, describe, expect, test, vi } from "vitest";

type TestSession = {
  user?: {
    id?: string;
    role?: unknown;
  };
};

const h = vi.hoisted(() => ({
  session: null as TestSession | null,
  auth: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getUser, normalizeAppRole, ROLES } from "../auth-helpers";

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_DISABLED = "false";
  h.session = null;
  h.auth.mockImplementation(async () => h.session);
});

describe("normalizeAppRole", () => {
  test.each(Object.values(ROLES))("resolves exact canonical role %s", (role) => {
    expect(normalizeAppRole(role)).toBe(role);
  });

  test.each([
    ["Admin", "noncanonical admin casing"],
    ["ADMIN", "uppercase admin"],
    ["Estimator", "noncanonical estimator casing"],
    ["EsTiMaToR", "mixed estimator casing"],
    [" admin", "leading whitespace"],
    ["admin ", "trailing whitespace"],
    [" estimator ", "surrounding whitespace"],
    ["", "empty string"],
    ["   ", "whitespace-only string"],
    ["superuser", "unknown string"],
    [null, "null"],
    [undefined, "undefined"],
    [{ role: "admin" }, "object"],
    [["admin"], "array"],
    [1, "number"],
    [true, "boolean"],
  ] satisfies Array<[unknown, string]>)("rejects %s (%s)", (role, _label) => {
    expect(normalizeAppRole(role)).toBeNull();
  });
});

describe("getUser role resolution", () => {
  test.each(Object.values(ROLES))("preserves exact canonical role %s", async (role) => {
    h.session = { user: { id: `user_${role}`, role } };

    await expect(getUser()).resolves.toEqual({ id: `user_${role}`, role });
  });

  test.each([
    [undefined, "missing"],
    [null, "null"],
    ["Admin", "mixed case"],
    [" estimator ", "whitespace altered"],
    [{ role: "admin" }, "malformed"],
    ["superuser", "unknown"],
  ] satisfies Array<[unknown, string]>)(
    "never defaults a %s role to an authorized role",
    async (role, _label) => {
    h.session = { user: { id: "user_invalid", role } };

    await expect(getUser()).resolves.toEqual({ id: "user_invalid", role: null });
    },
  );

  test("never defaults a missing role to estimator", async () => {
    h.session = { user: { id: "user_missing" } };

    await expect(getUser()).resolves.toEqual({ id: "user_missing", role: null });
  });
});
