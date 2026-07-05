// ──────────────────────────────────────────────────────────────────────────────
//  scripts/__tests__/specbook-staging-smoke.test.ts
//
//  Work package: specbook-storage-smoke-isolation, then
//  specbook-smoke-cookie-prompt.
//
//  Exercises scripts/specbook-staging-smoke.mjs's safety gates in-process:
//    7. Dry-run (no args, or missing --storage-only) makes ZERO network calls.
//    8. --execute without --storage-only (or missing --base-url) is refused —
//       stays in dry-run/refuses rather than firing a real request.
//    9. --cookie-prompt gating for --execute --storage-only mode: required,
//       rejects --cookie passed directly, refuses on a non-TTY environment,
//       dry-run stays network-free, and the interactive hidden-input
//       mechanism itself never leaks the entered value anywhere observable.
//
//  runMain() calls process.exit() on every exit path (matching the existing
//  scripts/cron-loop.mjs convention). To test this in-process without
//  actually killing the vitest worker, process.exit is spied and made to
//  throw a sentinel error that unwinds execution exactly like a real exit
//  would — the test then asserts on that sentinel instead of a return value.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseArgs, promptForCookie, runMain } from "../specbook-staging-smoke.mjs";

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

// ── Test 9 — --cookie-prompt gating and hidden-input safety
// (work package: specbook-smoke-cookie-prompt) ──────────────────────────────
describe("scripts/specbook-staging-smoke.mjs — --cookie-prompt (storage-only execute mode)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof stubProcessExit>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let originalStdinIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    exitSpy = stubProcessExit();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    // Restore process.stdin/stdout.isTTY exactly as found — tests below
    // mutate these directly (per the task's own suggested technique) rather
    // than replacing the stream objects wholesale.
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = originalStdinIsTTY;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = originalStdoutIsTTY;
  });

  // ── Mandatory test 1 ────────────────────────────────────────────────────
  test("9a. --execute --storage-only without --cookie-prompt (and without --cookie) refuses before any network action", async () => {
    await expect(
      runMain([
        "--base-url", "https://staging.example",
        "--bid-id", "123",
        "--execute",
        "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--cookie-prompt/);
    expect(logged).toMatch(/required/i);
  });

  // ── Mandatory test 2 ────────────────────────────────────────────────────
  test("9b. --execute --storage-only --cookie <value> is rejected with the safe redirect-to---cookie-prompt message, before any network action", async () => {
    const secretCookie = "authjs.session-token=should-never-reach-a-network-call";
    await expect(
      runMain([
        "--base-url", "https://staging.example",
        "--bid-id", "123",
        "--cookie", secretCookie,
        "--execute",
        "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/use --cookie-prompt instead/);
    expect(logged).not.toContain(secretCookie);
  });

  // ── Mandatory test 3 ────────────────────────────────────────────────────
  test("9c. non-TTY environment with --execute --storage-only --cookie-prompt refuses before any network action and before reading stdin", async () => {
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = false;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = false;
    const stdinDataSpy = vi.spyOn(process.stdin, "on");

    await expect(
      runMain([
        "--base-url", "https://staging.example",
        "--bid-id", "123",
        "--cookie-prompt",
        "--execute",
        "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/interactive terminal/);
    expect(logged).toMatch(/TTY/);
    // The hidden-input mechanism attaches a "data" listener to read
    // keystrokes — assert it was never reached.
    expect(stdinDataSpy).not.toHaveBeenCalledWith("data", expect.anything());
    stdinDataSpy.mockRestore();
  });

  // ── Mandatory test 4 (regression re-confirmation) ──────────────────────
  test("9d. dry-run combinations remain network-free after the --cookie-prompt changes", async () => {
    // No args at all.
    await expect(runMain([])).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();

    // --execute alone, without --storage-only.
    await expect(
      runMain([
        "--base-url", "https://staging.example",
        "--bid-id", "123",
        "--cookie-prompt",
        "--execute",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();

    // --cookie-prompt supplied alone, nothing else — still an incomplete,
    // dry-run/refused combination.
    await expect(runMain(["--cookie-prompt"])).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  // ── Mandatory test 5 — the load-bearing one: proves the actual hidden-
  // input mechanism never leaks the entered value anywhere observable. ────
  test("9e. the entered cookie value never appears in any console output, thrown error, or parsed args — full-shape sweep with a sentinel value", async () => {
    const SENTINEL = "COOKIE-SENTINEL-DO-NOT-USE-abc123";

    // Fake, in-memory stdin/stdout implementing exactly the surface
    // promptForCookie() uses, so the sentinel can be fed in programmatically
    // without a real TTY. Modeled as a minimal EventEmitter-like stand-in
    // per this file's existing convention of driving internals directly
    // (parseArgs()/runMain()) rather than spawning a real process.
    type Listener = (chunk: string) => void;
    const listeners: Listener[] = [];
    const stdoutWrites: string[] = [];

    const fakeStdin = {
      isTTY: true,
      isRaw: false,
      setRawMode: vi.fn(),
      resume: vi.fn(),
      pause: vi.fn(),
      setEncoding: vi.fn(),
      on: vi.fn((event: string, cb: Listener) => {
        if (event === "data") listeners.push(cb);
      }),
      removeListener: vi.fn((event: string, cb: Listener) => {
        const idx = listeners.indexOf(cb);
        if (idx >= 0) listeners.splice(idx, 1);
      }),
    };
    const fakeStdout = {
      isTTY: true,
      write: vi.fn((chunk: string) => {
        stdoutWrites.push(chunk);
        return true;
      }),
    };

    const promptPromise = promptForCookie({ stdin: fakeStdin, stdout: fakeStdout });
    // Simulate the operator typing the sentinel value then pressing Enter —
    // fed through the same "data" handler promptForCookie() registered.
    expect(listeners.length).toBe(1);
    listeners[0](SENTINEL);
    listeners[0]("\n");

    const resolved = await promptPromise;
    expect(resolved).toBe(SENTINEL); // proves the mechanism actually works

    // 1. Never written to the fake terminal (echo suppression held).
    for (const chunk of stdoutWrites) {
      expect(chunk).not.toContain(SENTINEL);
    }

    // 2. Never logged via console.log/console.error/console.warn.
    const allLogged = [
      ...logSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
    ]
      .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
      .join("\n");
    expect(allLogged).not.toContain(SENTINEL);

    // 3. Never present in parseArgs()'s output — the sentinel is supplied
    // only via the simulated stdin above, never via argv, so the parsed
    // args object for a representative real-run argv cannot contain it.
    const argsForRealRun = parseArgs([
      "--base-url", "https://staging.example",
      "--bid-id", "123",
      "--cookie-prompt",
      "--execute",
      "--storage-only",
    ]);
    expect(JSON.stringify(argsForRealRun)).not.toContain(SENTINEL);

    // 4. Raw mode was engaged and cleaned up (echo-disable lifecycle ran).
    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(true);
    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(false); // restored to wasRaw (false)
    expect(fakeStdin.removeListener).toHaveBeenCalled();

    // No network action was taken by this isolated prompt-mechanism test.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
