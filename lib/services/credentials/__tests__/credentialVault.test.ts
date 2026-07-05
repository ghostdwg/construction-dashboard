import { describe, expect, test } from "vitest";

// ──────────────────────────────────────────────────────────────────────────
//  Security hotfix (credential-vault-secret-redaction) — the vulnerable
//  maskValue() helper (which revealed real first-4/last-3 or first-2
//  plaintext characters) has been removed entirely, not neutered.
// ──────────────────────────────────────────────────────────────────────────

describe("credentialVault — maskValue removed", () => {
  test("maskValue is no longer exported", async () => {
    const mod = await import("../credentialVault");
    expect((mod as Record<string, unknown>).maskValue).toBeUndefined();
  });
});
