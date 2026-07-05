import { beforeEach, describe, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  isValidService: vi.fn(),
  isValidField: vi.fn(),
  upsertCredential: vi.fn(),
  deleteCredential: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: h.auth }));
vi.mock("@/lib/services/credentials/credentialsService", () => ({
  isValidService: h.isValidService,
  isValidField: h.isValidField,
  upsertCredential: h.upsertCredential,
  deleteCredential: h.deleteCredential,
}));

import { POST, DELETE } from "../route";

const FAKE_SECRET = "TOTALLY-FAKE-SENTINEL-do-not-use-credvault-post-8888";

function req(body: unknown) {
  return new Request("http://x/api/settings/credentials/beeline", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const routeParams = { params: Promise.resolve({ service: "beeline" }) };

describe("POST /api/settings/credentials/[service]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isValidService.mockReturnValue(true);
    h.isValidField.mockReturnValue(true);
  });

  test("unauthenticated -> 401, upsertCredential never invoked", async () => {
    h.auth.mockResolvedValue(null);
    const res = (await POST(req({ fields: { password: FAKE_SECRET } }), routeParams))!;
    expect(res.status).toBe(401);
    expect(h.upsertCredential).not.toHaveBeenCalled();
  });

  test("successful save never echoes the submitted plaintext back in the response", async () => {
    h.auth.mockResolvedValue({ user: { role: "admin" } });
    h.upsertCredential.mockResolvedValue(undefined);

    const res = (await POST(req({ fields: { password: FAKE_SECRET } }), routeParams))!;
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(FAKE_SECRET);
    expect(JSON.parse(text)).toEqual({ service: "beeline", updated: 1, errors: undefined });
  });

  test("a save failure's error message never contains the submitted plaintext", async () => {
    h.auth.mockResolvedValue({ user: { role: "admin" } });
    h.upsertCredential.mockRejectedValue(new Error("vault unavailable"));

    const res = (await POST(req({ fields: { password: FAKE_SECRET } }), routeParams))!;
    const text = await res.text();
    expect(text).not.toContain(FAKE_SECRET);
  });
});

describe("DELETE /api/settings/credentials/[service]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isValidService.mockReturnValue(true);
  });

  test("unauthenticated -> 401, deleteCredential never invoked", async () => {
    h.auth.mockResolvedValue(null);
    const res = (await DELETE(
      new Request("http://x/api/settings/credentials/beeline", { method: "DELETE" }),
      routeParams
    ))!;
    expect(res.status).toBe(401);
    expect(h.deleteCredential).not.toHaveBeenCalled();
  });
});
