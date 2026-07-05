// ──────────────────────────────────────────────────────────────────────────────
//  scripts/__tests__/specbook-staging-smoke.test.ts
//
//  Work package: specbook-storage-smoke-isolation.
//
//  Exercises scripts/specbook-staging-smoke.mjs's safety gates in-process:
//    7. Dry-run (no args, or missing --storage-only) makes ZERO network calls.
//    8. --execute without --storage-only (or missing --base-url) is refused —
//       stays in dry-run/refuses rather than firing a real request.
//
//  runMain() calls process.exit() on every exit path (matching the existing
//  scripts/cron-loop.mjs convention). To test this in-process without
//  actually killing the vitest worker, process.exit is spied and made to
//  throw a sentinel error that unwinds execution exactly like a real exit
//  would — the test then asserts on that sentinel instead of a return value.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseArgs, runMain } from "../specbook-staging-smoke.mjs";

class ProcessExitSentinel extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

function stubProcessExit() {
  return vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitSentinel(code);
  }) as never);
}

describe("scripts/specbook-staging-smoke.mjs — parseArgs (pure)", () => {
  test("defaults execute and storageOnly to false", () => {
    const args = parseArgs([]);
    expect(args.execute).toBe(false);
    expect(args.storageOnly).toBe(false);
  });

  test("parses --execute and --storage-only independently", () => {
    expect(parseArgs(["--execute"]).storageOnly).toBe(false);
    expect(parseArgs(["--storage-only"]).execute).toBe(false);
    const both = parseArgs(["--execute", "--storage-only"]);
    expect(both.execute).toBe(true);
    expect(both.storageOnly).toBe(true);
  });
});

describe("scripts/specbook-staging-smoke.mjs — runMain safety gates", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof stubProcessExit>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    exitSpy = stubProcessExit();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    logSpy.mockRestore();
  });

  // ── Test 7 — dry run makes zero network calls ─────────────────────────────
  test("7a. no arguments at all — dry run, zero fetch calls, exits 0", async () => {
    await expect(runMain([])).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("7b. --base-url and --bid-id supplied but --execute missing — still dry run, zero fetch calls", async () => {
    await expect(
      runMain(["--base-url", "https://staging.example", "--bid-id", "123"])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("7c. everything supplied except --storage-only — dry run, zero fetch calls", async () => {
    await expect(
      runMain([
        "--base-url", "https://staging.example",
        "--bid-id", "123",
        "--cookie", "session=fake",
        "--execute",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  // ── Test 8 — refuses unsafe/incomplete real-run inputs ────────────────────
  test("8a. --execute without --storage-only is refused with an explanatory message, not silently upgraded", async () => {
    await expect(
      runMain([
        "--base-url", "https://staging.example",
        "--bid-id", "123",
        "--cookie", "session=fake",
        "--execute",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--storage-only/);
  });

  test("8b. missing --base-url entirely (even with --execute --storage-only) refuses, no fetch call", async () => {
    await expect(
      runMain([
        "--bid-id", "123",
        "--cookie", "session=fake",
        "--execute",
        "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--base-url/);
  });

  test("8c. --base-url not referencing a staging host is refused for a real run, no fetch call", async () => {
    await expect(
      runMain([
        "--base-url", "https://groundworx.neuroglitch.ai", // production hostname, no "staging"
        "--bid-id", "123",
        "--cookie", "session=fake",
        "--execute",
        "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/staging/);
  });

  test("8d. missing auth input (no --cookie/--bearer) refuses even with --execute --storage-only", async () => {
    await expect(
      runMain([
        "--base-url", "https://staging.example",
        "--bid-id", "123",
        "--execute",
        "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--cookie/);
  });

  // ── Logging discipline — never print cookie/bearer values in the refusal
  // path (this path never even reaches authHeaders(), but assert anyway
  // since this is the boundary a future refactor is most likely to weaken).
  test("refusal-path logging never echoes the supplied cookie value", async () => {
    const secretCookie = "authjs.session-token=super-secret-value-should-not-leak";
    await expect(
      runMain([
        "--base-url", "https://staging.example",
        "--bid-id", "123",
        "--cookie", secretCookie,
        "--execute", // no --storage-only -> refused before any auth header is built
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).not.toContain(secretCookie);
    expect(logged).not.toContain("super-secret-value-should-not-leak");
  });
});
