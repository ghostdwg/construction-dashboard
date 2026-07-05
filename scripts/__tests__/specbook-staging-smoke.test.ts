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
import { looksLikeCookiePair, parseArgs, promptForCookie, runMain } from "../specbook-staging-smoke.mjs";

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

// ── Test 10 — full storage-only run + step 7 self-cleanup
// (work package: specbook-smoke-self-cleanup) ───────────────────────────────
//
// These tests drive the full 6-step (now 7-step) real-run flow in-process by
// stubbing process.stdin/process.stdout to simulate an interactive
// --cookie-prompt entry (mirroring test 9e's fake-stream technique, but
// applied to the real process.stdin/stdout objects since runMain() calls
// promptForCookie() with no arguments) and routing `fetch` calls by
// URL/method to canned responses matching each route's real shape.
describe("scripts/specbook-staging-smoke.mjs — full run + step 7 self-cleanup", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof stubProcessExit>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalStdinIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;
  let originalStdinMethods: Record<string, unknown>;
  let originalStdoutWrite: unknown;

  const BASE = "https://staging.example";
  const BID = "123";
  const FIRST_ID = 90210111;
  const SECOND_ID = 90210222;
  const SECTION_ID = 90210555;
  const COOKIE_VALUE = "authjs.session-token=full-run-test-cookie";

  type CannedResponse = {
    status: number;
    json?: unknown;
    text?: string;
    headers?: Record<string, string>;
  };

  function makeResponse(r: CannedResponse) {
    return {
      status: r.status,
      json: async () => (r.json === undefined ? null : r.json),
      text: async () => r.text ?? "",
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
    };
  }

  function buildRouterFetchMock(opts: {
    cleanupStatus?: number;
    secondAutomationStatus?: string;
    preflightStatus?: number;
    preflightAppEnv?: string | null;
  } = {}) {
    const cleanupStatus = opts.cleanupStatus ?? 204;
    const secondAutomationStatus = opts.secondAutomationStatus ?? "suppressed_for_storage_smoke";
    const preflightStatus = opts.preflightStatus ?? 200;
    const preflightAppEnv = opts.preflightAppEnv === undefined ? "staging" : opts.preflightAppEnv;
    let uploadCalls = 0;
    let gapsCalls = 0;
    return async (url: string, init: Record<string, unknown> = {}) => {
      const method = (init.method as string) || "GET";
      if (url === `${BASE}/api/bids/${BID}` && method === "GET") {
        return makeResponse({
          status: preflightStatus,
          json: preflightStatus === 200 ? { id: Number(BID) } : { error: "Not found" },
          headers: preflightAppEnv !== null ? { "x-app-env": preflightAppEnv } : {},
        });
      }
      if (url === `${BASE}/api/bids/${BID}/specbook/upload` && method === "POST") {
        uploadCalls++;
        if (uploadCalls === 1) {
          return makeResponse({
            status: 201,
            json: { id: FIRST_ID, _count: { sections: 2 }, automationStatus: "suppressed_for_storage_smoke" },
          });
        }
        return makeResponse({
          status: 201,
          json: { id: SECOND_ID, _count: { sections: 2 }, automationStatus: secondAutomationStatus },
        });
      }
      if (url === `${BASE}/api/bids/${BID}/specbook/split` && method === "POST") {
        return makeResponse({ status: 200, json: { sectionsCreated: 2, sectionCount: 2 } });
      }
      if (url === `${BASE}/api/bids/${BID}/specbook/gaps` && method === "GET") {
        gapsCalls++;
        if (gapsCalls === 1) {
          return makeResponse({ status: 200, json: { covered: [{ id: SECTION_ID }], missing: [], unknown: [] } });
        }
        return makeResponse({ status: 200, json: null });
      }
      if (url === `${BASE}/api/bids/${BID}/specbook/sections/${SECTION_ID}/pdf`) {
        if (init.redirect === "manual") {
          return makeResponse({ status: 302, headers: { location: "/login?callbackUrl=%2F" } });
        }
        return makeResponse({ status: 200, headers: { "content-type": "application/pdf" } });
      }
      if (url === `${BASE}/api/bids/${BID}/specbook/${FIRST_ID}` && method === "DELETE") {
        return makeResponse({ status: 204 });
      }
      if (url === `${BASE}/api/bids/${BID}/specbook/${SECOND_ID}` && method === "DELETE") {
        return makeResponse({ status: cleanupStatus });
      }
      throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
    };
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    exitSpy = stubProcessExit();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;

    (process.stdin as unknown as { isTTY?: boolean }).isTTY = true;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = true;

    // Some of these methods (setRawMode in particular) only exist on a real
    // TTY-backed stream and may be entirely absent from process.stdin in the
    // test runner's environment — vi.spyOn() requires the property to
    // already exist, so these are assigned directly (and restored directly
    // in afterEach) rather than spied on, mirroring test 9c/9d's technique
    // of mutating process.stdin/stdout directly rather than replacing the
    // stream objects wholesale.
    const stdinAny = process.stdin as unknown as Record<string, unknown>;
    const stdoutAny = process.stdout as unknown as Record<string, unknown>;
    originalStdinMethods = {
      setRawMode: stdinAny.setRawMode,
      resume: stdinAny.resume,
      pause: stdinAny.pause,
      setEncoding: stdinAny.setEncoding,
      on: stdinAny.on,
      removeListener: stdinAny.removeListener,
    };
    originalStdoutWrite = stdoutAny.write;

    stdinAny.setRawMode = vi.fn(() => process.stdin);
    stdinAny.resume = vi.fn(() => process.stdin);
    stdinAny.pause = vi.fn(() => process.stdin);
    stdinAny.setEncoding = vi.fn(() => process.stdin);
    stdinAny.on = vi.fn((event: string, cb: (chunk: string) => void) => {
      if (event === "data") {
        // Simulate the operator typing the cookie then pressing Enter,
        // asynchronously so promptForCookie()'s Promise resolves shortly
        // after runMain() awaits it, exactly like a real keystroke would.
        queueMicrotask(() => cb(`${COOKIE_VALUE}\n`));
      }
      return process.stdin;
    });
    stdinAny.removeListener = vi.fn(() => process.stdin);
    stdoutAny.write = vi.fn(() => true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    logSpy.mockRestore();
    const stdinAny = process.stdin as unknown as Record<string, unknown>;
    const stdoutAny = process.stdout as unknown as Record<string, unknown>;
    Object.assign(stdinAny, originalStdinMethods);
    stdoutAny.write = originalStdoutWrite;
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = originalStdinIsTTY;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = originalStdoutIsTTY;
  });

  function runArgs() {
    return [
      "--base-url", BASE,
      "--bid-id", BID,
      "--cookie-prompt",
      "--execute",
      "--storage-only",
    ];
  }

  test("10a. a fully successful run attempts a 7th cleanup-delete against the re-upload's exact id and records it PASS", async () => {
    fetchMock.mockImplementation(buildRouterFetchMock({ cleanupStatus: 204 }));

    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);

    expect(exitSpy).toHaveBeenCalledWith(0);

    // The final cleanup DELETE was issued against the re-upload's own id.
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as { method?: string })?.method === "DELETE"
    );
    expect(deleteCalls.some(([url]) => url === `${BASE}/api/bids/${BID}/specbook/${SECOND_ID}`)).toBe(true);

    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/7\. final cleanup delete/);
    expect(logged).toMatch(/PASS\s+7\. final cleanup delete/);
  });

  test("10b. cleanup delete failing (non-204) is recorded FAIL but does not crash — script still exits with a non-zero code", async () => {
    fetchMock.mockImplementation(buildRouterFetchMock({ cleanupStatus: 500 }));

    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);

    // Exits cleanly via the normal process.exit() path (not an unhandled
    // exception) with a non-zero code reflecting the failure.
    expect(exitSpy).toHaveBeenCalledWith(1);

    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+7\. final cleanup delete/);
  });

  test("10c. automationStatus assertion failing on the re-upload still triggers a best-effort cleanup attempt of the known id", async () => {
    fetchMock.mockImplementation(
      buildRouterFetchMock({ cleanupStatus: 204, secondAutomationStatus: "triggered" })
    );

    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);

    // 6c fails (wrong automationStatus)...
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+6c\. automation suppressed/);
    // ...but the cleanup delete of the known (re-upload's own) id was still
    // attempted and succeeded.
    const deleteCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as { method?: string })?.method === "DELETE"
    );
    expect(deleteCalls.some(([url]) => url === `${BASE}/api/bids/${BID}/specbook/${SECOND_ID}`)).toBe(true);
    expect(logged).toMatch(/PASS\s+7\. final cleanup delete/);
    // Overall run still fails (6c's FAIL contributes to a non-zero exit).
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("10d. no console output contains a raw numeric SpecBook id anywhere in a successful full run", async () => {
    fetchMock.mockImplementation(buildRouterFetchMock({ cleanupStatus: 204 }));

    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);

    const logged = logSpy.mock.calls.flat().join("\n");
    // Neither SpecBook id (first upload's or the re-upload's) ever appears
    // bare in any logged output — this is the requirement-5 redaction check.
    expect(logged).not.toMatch(new RegExp(`\\b${FIRST_ID}\\b`));
    expect(logged).not.toMatch(new RegExp(`\\b${SECOND_ID}\\b`));
    // The specific pre-existing leak pattern this task required removing.
    expect(logged).not.toMatch(/specBookId=\d/);
    // The interactively-entered cookie value must never appear either.
    expect(logged).not.toContain(COOKIE_VALUE);
  });
});

// ── Test 11 — cookie-shape validation (pure) and preflight bid check
// (work package: specbook-smoke-fail-closed) ────────────────────────────────
describe("scripts/specbook-staging-smoke.mjs — looksLikeCookiePair (pure)", () => {
  test("accepts a well-formed name=value pair", () => {
    expect(looksLikeCookiePair("authjs.session-token=abc.def-ghi_123")).toBe(true);
    expect(looksLikeCookiePair("a=b")).toBe(true);
  });

  test("rejects a value with no '=' at all", () => {
    expect(looksLikeCookiePair("not-a-cookie-at-all")).toBe(false);
  });

  test("rejects an empty name before '='", () => {
    expect(looksLikeCookiePair("=missing-name")).toBe(false);
  });

  test("rejects an empty value after '='", () => {
    expect(looksLikeCookiePair("session-token=")).toBe(false);
  });

  test("rejects an empty string", () => {
    expect(looksLikeCookiePair("")).toBe(false);
  });

  test("rejects a non-string value", () => {
    expect(looksLikeCookiePair(undefined as unknown as string)).toBe(false);
    expect(looksLikeCookiePair(null as unknown as string)).toBe(false);
  });
});

describe("scripts/specbook-staging-smoke.mjs — preflight bid check + cookie-shape gate (work package: specbook-smoke-fail-closed)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof stubProcessExit>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalStdinIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;
  let originalStdinMethods: Record<string, unknown>;
  let originalStdoutWrite: unknown;

  const BASE = "https://staging.example";
  const BID = "123";
  const COOKIE_VALUE = "authjs.session-token=preflight-test-cookie";

  function stubCookiePrompt(value: string) {
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = true;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = true;
    const stdinAny = process.stdin as unknown as Record<string, unknown>;
    const stdoutAny = process.stdout as unknown as Record<string, unknown>;
    stdinAny.setRawMode = vi.fn(() => process.stdin);
    stdinAny.resume = vi.fn(() => process.stdin);
    stdinAny.pause = vi.fn(() => process.stdin);
    stdinAny.setEncoding = vi.fn(() => process.stdin);
    stdinAny.on = vi.fn((event: string, cb: (chunk: string) => void) => {
      if (event === "data") queueMicrotask(() => cb(`${value}\n`));
      return process.stdin;
    });
    stdinAny.removeListener = vi.fn(() => process.stdin);
    stdoutAny.write = vi.fn(() => true);
  }

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    exitSpy = stubProcessExit();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    originalStdinIsTTY = process.stdin.isTTY;
    originalStdoutIsTTY = process.stdout.isTTY;
    const stdinAny = process.stdin as unknown as Record<string, unknown>;
    const stdoutAny = process.stdout as unknown as Record<string, unknown>;
    originalStdinMethods = {
      setRawMode: stdinAny.setRawMode,
      resume: stdinAny.resume,
      pause: stdinAny.pause,
      setEncoding: stdinAny.setEncoding,
      on: stdinAny.on,
      removeListener: stdinAny.removeListener,
    };
    originalStdoutWrite = stdoutAny.write;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    exitSpy.mockRestore();
    logSpy.mockRestore();
    const stdinAny = process.stdin as unknown as Record<string, unknown>;
    const stdoutAny = process.stdout as unknown as Record<string, unknown>;
    Object.assign(stdinAny, originalStdinMethods);
    stdoutAny.write = originalStdoutWrite;
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = originalStdinIsTTY;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = originalStdoutIsTTY;
  });

  function runArgs() {
    return ["--base-url", BASE, "--bid-id", BID, "--cookie-prompt", "--execute", "--storage-only"];
  }

  // ── Cookie-shape gate — checked before any network call ───────────────────

  test("11a. malformed cookie (no '=') refuses before any fetch call", async () => {
    stubCookiePrompt("not-a-cookie-at-all");
    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/0a\. cookie shape/);
    expect(logged).toMatch(/FAIL/);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  test("11b. malformed cookie (empty name before '=') refuses before any fetch call", async () => {
    stubCookiePrompt("=missing-name");
    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("11c. malformed cookie (empty value after '=') refuses before any fetch call", async () => {
    stubCookiePrompt("session-token=");
    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // ── Preflight bid check — positive case ────────────────────────────────────

  test("11d. preflight succeeds ONLY for 200 + JSON + X-App-Env=staging, then proceeds to step 1", async () => {
    stubCookiePrompt(COOKIE_VALUE);
    fetchMock.mockImplementation(async (url: string, init: Record<string, unknown> = {}) => {
      const method = (init.method as string) || "GET";
      if (url === `${BASE}/api/bids/${BID}` && method === "GET") {
        return {
          status: 200,
          json: async () => ({ id: Number(BID) }),
          headers: { get: (k: string) => (k.toLowerCase() === "x-app-env" ? "staging" : null) },
        };
      }
      if (url === `${BASE}/api/bids/${BID}/specbook/upload` && method === "POST") {
        // A controlled stub failure — what matters here is only that the
        // preflight passed and step 1 was actually attempted afterward.
        return { status: 422, json: async () => ({ error: "stub" }), headers: { get: () => null } };
      }
      throw new Error(`Unexpected fetch call in test: ${method} ${url}`);
    });

    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/PASS\s+0\. preflight bid check/);
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/bids/${BID}/specbook/upload`,
      expect.objectContaining({ method: "POST" })
    );
    // Confirm the preflight itself used redirect: "manual".
    const preflightCall = fetchMock.mock.calls.find(([url]) => url === `${BASE}/api/bids/${BID}`);
    expect(preflightCall?.[1]).toMatchObject({ redirect: "manual" });
  });

  // ── Preflight bid check — refusal cases ────────────────────────────────────

  test("11e. preflight refuses on 404 (bid missing) — never attempts step 1", async () => {
    stubCookiePrompt(COOKIE_VALUE);
    fetchMock.mockImplementation(async () => ({
      status: 404,
      json: async () => ({ error: "Not found" }),
      headers: { get: () => null },
    }));
    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+0\. preflight bid check/);
    expect(logged).toMatch(/does not exist/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("11f. preflight refuses on a redirect (3xx) response, never attempts step 1", async () => {
    stubCookiePrompt(COOKIE_VALUE);
    fetchMock.mockImplementation(async () => ({
      status: 302,
      json: async () => {
        throw new Error("no body");
      },
      headers: { get: (k: string) => (k.toLowerCase() === "location" ? "/login" : null) },
    }));
    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+0\. preflight bid check/);
    expect(logged).toMatch(/redirect/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  test("11g. preflight refuses on a non-JSON (HTML) response, never attempts step 1", async () => {
    stubCookiePrompt(COOKIE_VALUE);
    fetchMock.mockImplementation(async () => ({
      status: 200,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
      headers: { get: (k: string) => (k.toLowerCase() === "x-app-env" ? "staging" : null) },
    }));
    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+0\. preflight bid check/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("11h. preflight refuses when X-App-Env header is missing, never attempts step 1", async () => {
    stubCookiePrompt(COOKIE_VALUE);
    fetchMock.mockImplementation(async () => ({
      status: 200,
      json: async () => ({ id: Number(BID) }),
      headers: { get: () => null },
    }));
    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+0\. preflight bid check/);
    expect(logged).toMatch(/X-App-Env/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("11i. preflight refuses when X-App-Env header is the wrong value, never attempts step 1", async () => {
    stubCookiePrompt(COOKIE_VALUE);
    fetchMock.mockImplementation(async () => ({
      status: 200,
      json: async () => ({ id: Number(BID) }),
      headers: { get: (k: string) => (k.toLowerCase() === "x-app-env" ? "production" : null) },
    }));
    await expect(runMain(runArgs())).rejects.toBeInstanceOf(ProcessExitSentinel);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+0\. preflight bid check/);
    expect(logged).toMatch(/production/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // ── Full-shape sweep — no sensitive value ever appears in logged output ────

  test("11j. no cookie value, response body field, or bid detail ever appears in logged output across every scenario above", async () => {
    const scenarios: Array<() => Promise<unknown>> = [
      async () => {
        stubCookiePrompt("not-a-cookie-at-all");
        return runMain(runArgs());
      },
      async () => {
        stubCookiePrompt(COOKIE_VALUE);
        fetchMock.mockImplementation(async () => ({
          status: 200,
          json: async () => ({ id: Number(BID), secretField: "should-never-appear-in-logs" }),
          headers: { get: () => null }, // missing X-App-Env -> fails
        }));
        return runMain(runArgs());
      },
      async () => {
        stubCookiePrompt(COOKIE_VALUE);
        fetchMock.mockImplementation(async () => ({
          status: 404,
          json: async () => ({ error: "Not found" }),
          headers: { get: () => null },
        }));
        return runMain(runArgs());
      },
    ];

    for (const scenario of scenarios) {
      fetchMock.mockReset();
      logSpy.mockClear();
      await expect(scenario()).rejects.toBeInstanceOf(ProcessExitSentinel);
      const logged = logSpy.mock.calls.flat().join("\n");
      expect(logged).not.toContain(COOKIE_VALUE);
      expect(logged).not.toContain("not-a-cookie-at-all");
      expect(logged).not.toContain("should-never-appear-in-logs");
    }
  });
});
