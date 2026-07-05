import { beforeEach, describe, expect, test, vi } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  Security hotfix (credential-vault-secret-redaction) — proves the actual
//  reachable credential-vault surface (listIntegrations / upsertCredential)
//  never renders, returns, or serializes any fragment of a real credential
//  value, using sentinel fake values that would have leaked under the old
//  (now-removed) maskValue() helper.
// ──────────────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
  deleteMany: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  encrypt: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    integrationCredential: {
      findMany: h.findMany,
      upsert: h.upsert,
      deleteMany: h.deleteMany,
      updateMany: h.updateMany,
      findUnique: h.findUnique,
    },
  },
}));

vi.mock("../credentialVault", () => ({
  encrypt: h.encrypt,
}));

import { listIntegrations, upsertCredential } from "../credentialsService";

// Deliberately NOT shaped like a real credential — obviously-fake sentinels.
const FAKE_PASSWORD = "TOTALLY-FAKE-PASSWORD-SENTINEL-do-not-use-9876";
const FAKE_API_KEY = "TOTALLY-FAKE-APIKEY-SENTINEL-do-not-use-abcd1234wxyz";
const FAKE_USERNAME = "totally.fake.sentinel.username@example.invalid";

function assertNoLeakage(payload: unknown) {
  const serialized = JSON.stringify(payload);
  expect(serialized).not.toContain(FAKE_PASSWORD);
  expect(serialized).not.toContain(FAKE_API_KEY);
  expect(serialized).not.toContain(FAKE_USERNAME);
  // Old maskValue() shape: first-4 + bullets + last-3, or first-2 + stars.
  expect(serialized).not.toMatch(/[•]{4,}\w{2,4}/);
  expect(serialized).not.toMatch(/^\w{2,4}[•*]{2,}/m);
}

describe("listIntegrations — never decrypts, never leaks any field's real value", () => {
  beforeEach(() => vi.clearAllMocks());

  test("password field -> fixed 8-bullet mask, never derived from any real value", async () => {
    h.findMany.mockResolvedValue([
      {
        service: "beeline",
        field: "password",
        encryptedValue: "enc:" + FAKE_PASSWORD, // even the "ciphertext" here is a sentinel
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        lastTestedAt: null,
        lastTestStatus: null,
        lastTestError: null,
      },
    ]);

    const result = await listIntegrations();
    expect(result[0].fields[0].masked).toBe("••••••••");
    assertNoLeakage(result);
  });

  test("api_key / username / other fields -> fixed '(set)' marker, never a character-derived mask", async () => {
    h.findMany.mockResolvedValue([
      { service: "dodge", field: "api_key", encryptedValue: "enc:" + FAKE_API_KEY, updatedAt: new Date(), lastTestedAt: null, lastTestStatus: null, lastTestError: null },
      { service: "dodge", field: "username", encryptedValue: "enc:" + FAKE_USERNAME, updatedAt: new Date(), lastTestedAt: null, lastTestStatus: null, lastTestError: null },
    ]);

    const result = await listIntegrations();
    const dodge = result.find((r) => r.service === "dodge")!;
    for (const f of dodge.fields) {
      expect(f.masked).toBe("(set)");
    }
    assertNoLeakage(result);
  });

  test("lastTestError is passed through verbatim (already sanitized upstream) but never contains a submitted credential in this test's fixtures", async () => {
    h.findMany.mockResolvedValue([
      {
        service: "beeline",
        field: "password",
        encryptedValue: "enc:x",
        updatedAt: new Date(),
        lastTestedAt: new Date(),
        lastTestStatus: "failed",
        lastTestError: "vault read failed: decryption error",
      },
    ]);
    const result = await listIntegrations();
    assertNoLeakage(result);
  });
});

describe("upsertCredential — never echoes the submitted plaintext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.encrypt.mockReturnValue({ encryptedValue: "enc:opaque", iv: "iv", authTag: "tag", algorithm: "aes-256-gcm" });
    h.upsert.mockResolvedValue({});
  });

  test("successful save returns void — nothing to leak, and encrypt() (not the raw value) is what's persisted", async () => {
    await upsertCredential({ service: "beeline", field: "password", plaintext: FAKE_PASSWORD });
    expect(h.encrypt).toHaveBeenCalledWith(FAKE_PASSWORD);
    // Only the encrypted-shape output reaches prisma — never the plaintext.
    const upsertArg = h.upsert.mock.calls[0][0];
    assertNoLeakage(upsertArg);
  });

  test("invalid service/field errors never contain the submitted plaintext", async () => {
    await expect(
      upsertCredential({ service: "not-a-real-service", field: "password", plaintext: FAKE_PASSWORD })
    ).rejects.toThrow();
    try {
      await upsertCredential({ service: "not-a-real-service", field: "password", plaintext: FAKE_PASSWORD });
    } catch (err) {
      expect(String(err)).not.toContain(FAKE_PASSWORD);
    }
  });
});
