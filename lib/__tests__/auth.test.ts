import { beforeEach, describe, expect, test, vi } from "vitest";

type TestSession = {
  user?: Record<string, unknown>;
};

type JwtCallback = (input: {
  token: Record<string, unknown>;
  user?: { id?: string; role?: unknown };
}) => Promise<Record<string, unknown>>;

type SessionCallback = (input: {
  session: TestSession;
  token: Record<string, unknown>;
}) => Promise<TestSession>;

type CapturedAuthConfig = {
  callbacks?: {
    jwt?: JwtCallback;
    session?: SessionCallback;
  };
};

const h = vi.hoisted(() => ({
  session: null as TestSession | null,
  config: null as CapturedAuthConfig | null,
  auth: vi.fn(),
}));

vi.mock("next-auth", () => ({
  default: vi.fn((config: CapturedAuthConfig) => {
    h.config = config;
    return {
      handlers: {},
      signIn: vi.fn(),
      signOut: vi.fn(),
      auth: h.auth,
    };
  }),
}));
vi.mock("next-auth/providers/credentials", () => ({
  default: vi.fn((config: unknown) => config),
}));
vi.mock("@auth/prisma-adapter", () => ({ PrismaAdapter: vi.fn(() => ({})) }));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { isAdminAuthorized } from "../auth";

function authCallbacks(): { jwt: JwtCallback; session: SessionCallback } {
  const jwt = h.config?.callbacks?.jwt;
  const session = h.config?.callbacks?.session;
  if (!jwt || !session) throw new Error("Auth callbacks were not captured");
  return { jwt, session };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AUTH_DISABLED = "false";
  h.session = null;
  h.auth.mockImplementation(async () => h.session);
});

describe("session and JWT role propagation", () => {
  test.each(["admin", "estimator", "pm"])(
    "preserves exact canonical %s without transformation",
    async (role) => {
      const { jwt, session } = authCallbacks();
      const token = await jwt({ token: {}, user: { id: "user_1", role } });
      const resolved = await session({ session: { user: {} }, token });

      expect(token).toEqual({ id: "user_1", role });
      expect(resolved.user).toEqual({ id: "user_1", role });
    },
  );

  test("a missing database role never defaults to estimator in the JWT or session", async () => {
    const { jwt, session } = authCallbacks();
    const token = await jwt({ token: {}, user: { id: "user_missing" } });
    const resolved = await session({ session: { user: {} }, token });

    expect(token.role).toBeUndefined();
    expect(resolved.user?.role).toBeUndefined();
  });

  test.each(["Admin", " ADMIN ", "EsTiMaToR", { role: "admin" }, 1, true])(
    "does not repair malformed role %s while propagating it",
    async (role) => {
      const { jwt, session } = authCallbacks();
      const token = await jwt({ token: {}, user: { id: "user_invalid", role } });
      const resolved = await session({ session: { user: {} }, token });

      expect(token.role).toEqual(role);
      expect(resolved.user?.role).toEqual(role);
    },
  );
});

describe("isAdminAuthorized exact role policy", () => {
  test("authorizes exact lowercase admin", async () => {
    h.session = { user: { role: "admin" } };

    await expect(isAdminAuthorized()).resolves.toEqual({ authorized: true });
  });

  test.each(["Admin", "ADMIN", " admin", "admin ", " admin ", "estimator", "pm"])(
    "rejects non-admin or noncanonical role %s",
    async (role) => {
      h.session = { user: { role } };

      await expect(isAdminAuthorized()).resolves.toEqual({
        authorized: false,
        status: 403,
        error: "Admin access required",
      });
    },
  );

  test.each([undefined, null, { role: "admin" }, ["admin"], 1, true])(
    "rejects missing or malformed role %s",
    async (role) => {
      h.session = { user: { role } };

      await expect(isAdminAuthorized()).resolves.toEqual({
        authorized: false,
        status: 403,
        error: "Admin access required",
      });
    },
  );
});
