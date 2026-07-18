// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/__tests__/env.test.ts
//
//  Locks in a real bug found during the end-to-end proof run: a gate
//  legitimately setting DATABASE_URL to a disposable `file:` path (the
//  intended, safe pattern every gate uses) must NEVER be flagged as a
//  network-isolation violation — only a non-local DATABASE_URL, or an actual
//  forbidden credential key, should be.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import { buildAllowlistedEnv as buildAllowlistedEnvRaw, withRecordingExec, assertNetworkIsolation } from "../lib/env.mjs";

const buildAllowlistedEnv = buildAllowlistedEnvRaw as unknown as (
  ambient: Record<string, string>,
  overrides?: Record<string, string>
) => Record<string, string>;

describe("buildAllowlistedEnv", () => {
  test("only passes through allowlisted ambient keys", () => {
    const env = buildAllowlistedEnv({ PATH: "/usr/bin", ANTHROPIC_API_KEY: "sk-real-secret", RANDOM_VAR: "x" });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.RANDOM_VAR).toBeUndefined();
  });

  test("applies a local file: DATABASE_URL override", () => {
    const env = buildAllowlistedEnv({}, { DATABASE_URL: "file:/tmp/x.db" });
    expect(env.DATABASE_URL).toBe("file:/tmp/x.db");
  });

  test("rejects a non-local DATABASE_URL override", () => {
    expect(() => buildAllowlistedEnv({}, { DATABASE_URL: "libsql://prod-db.turso.io" })).toThrow();
  });
});

describe("assertNetworkIsolation", () => {
  test("does NOT flag a gate's legitimate disposable file: DATABASE_URL", () => {
    const { exec, calls } = withRecordingExec(() => ({ status: 0, stdout: "", stderr: "" }));
    exec("npx", ["prisma", "migrate", "deploy"], { env: buildAllowlistedEnv({}, { DATABASE_URL: "file:/tmp/scratch.db" }) });
    expect(assertNetworkIsolation(calls)).toEqual([]);
  });

  test("flags a non-local DATABASE_URL as a violation", () => {
    const { exec, calls } = withRecordingExec(() => ({ status: 0, stdout: "", stderr: "" }));
    exec("npx", ["prisma", "migrate", "deploy"], { env: { DATABASE_URL: "libsql://staging.turso.io" } });
    expect(assertNetworkIsolation(calls).length).toBeGreaterThan(0);
  });

  test("flags a forbidden credential key as a violation", () => {
    const { exec, calls } = withRecordingExec(() => ({ status: 0, stdout: "", stderr: "" }));
    exec("node", ["some-script.mjs"], { env: { ANTHROPIC_API_KEY: "sk-real" } });
    expect(assertNetworkIsolation(calls).length).toBeGreaterThan(0);
  });

  test("passes across a realistic multi-call gate sequence (install, generate, validate, replay, upgrade stages)", () => {
    const { exec, calls } = withRecordingExec(() => ({ status: 0, stdout: "", stderr: "" }));
    exec("npm", ["ci"], { env: buildAllowlistedEnv({ PATH: "/usr/bin" }, {}) });
    exec("npx", ["prisma", "generate"], { env: buildAllowlistedEnv({}, { DATABASE_URL: "file:/tmp/gen.db" }) });
    exec("npx", ["prisma", "validate"], { env: buildAllowlistedEnv({}, { DATABASE_URL: "file:/tmp/validate.db" }) });
    exec("node", ["scripts/replay-validation.mjs"], { env: buildAllowlistedEnv({}, { REPLAY_DB_PATH: "/tmp/replay.db" }) });
    for (let i = 0; i < 3; i++) {
      exec("npx", ["prisma", "migrate", "deploy"], { env: buildAllowlistedEnv({}, { DATABASE_URL: `file:/tmp/stage-${i}.db` }) });
    }
    expect(assertNetworkIsolation(calls)).toEqual([]);
  });
});
