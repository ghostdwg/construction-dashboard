// ──────────────────────────────────────────────────────────────────────────────
//  scripts/__tests__/artifacts-staging-smoke.test.ts
//
//  Work package: GWX-Q06a (artifacts-staging-smoke-isolation).
//
//  Exercises scripts/artifacts-staging-smoke.mjs's safety gates in-process,
//  mirroring scripts/__tests__/specbook-staging-smoke.test.ts's conventions:
//    - Dry-run (no args, or missing --storage-only/--domain) makes ZERO
//      network calls.
//    - --execute without --storage-only (or missing --base-url/--domain) is
//      refused — stays in dry-run/refuses rather than firing a real request.
//    - --cookie-prompt gating for --execute --storage-only mode: required,
//      rejects --cookie/--bearer passed directly, refuses on a non-TTY
//      environment.
//    - Full per-domain run behavior: Drawings (upload gated — marker header
//      sent on the upload, automationStatus body field asserted,
//      self-cleanup delete), Addendums (upload NOT gated — no marker on the
//      upload; cleanup DELETE IS gated per the captain's cross-track ruling
//      — marker header sent on the delete, X-Automation-Status response
//      header asserted, loud FAIL when missing), Estimates (not gated,
//      requires --subcontractor-id, NO delete endpoint exists so no cleanup
//      is attempted — a loud warning is logged instead).
//
//  runMain() calls process.exit() on every exit path — process.exit is
//  spied and made to throw a sentinel error that unwinds execution exactly
//  like a real exit would, same convention as the specbook smoke test.
// ──────────────────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { looksLikeCookiePair, parseArgs, promptForCookie, runMain } from "../artifacts-staging-smoke.mjs";

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

const BASE = "https://staging.example";
const BID = "123";

describe("scripts/artifacts-staging-smoke.mjs — parseArgs (pure)", () => {
  test("defaults execute and storageOnly to false", () => {
    const args = parseArgs([]);
    expect(args.execute).toBe(false);
    expect(args.storageOnly).toBe(false);
  });

  test("parses --domain, --execute, --storage-only, --subcontractor-id independently", () => {
    const args = parseArgs([
      "--domain", "estimates",
      "--execute",
      "--storage-only",
      "--subcontractor-id", "45",
    ]) as { domain?: string; execute: boolean; storageOnly: boolean; subcontractorId?: string };
    expect(args.domain).toBe("estimates");
    expect(args.execute).toBe(true);
    expect(args.storageOnly).toBe(true);
    expect(args.subcontractorId).toBe("45");
  });
});

describe("scripts/artifacts-staging-smoke.mjs — looksLikeCookiePair (pure)", () => {
  test("accepts a well-formed name=value pair", () => {
    expect(looksLikeCookiePair("authjs.session-token=abc.def-ghi_123")).toBe(true);
  });
  test("rejects malformed values", () => {
    expect(looksLikeCookiePair("not-a-cookie-at-all")).toBe(false);
    expect(looksLikeCookiePair("=missing-name")).toBe(false);
    expect(looksLikeCookiePair("session-token=")).toBe(false);
    expect(looksLikeCookiePair("")).toBe(false);
    expect(looksLikeCookiePair(undefined as unknown as string)).toBe(false);
  });
});

describe("scripts/artifacts-staging-smoke.mjs — dry-run gates (zero network)", () => {
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

  test("no arguments at all — dry run, zero fetch calls, exits 0", async () => {
    await expect(runMain([])).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  test("missing --domain entirely — dry run, zero fetch calls", async () => {
    await expect(
      runMain(["--base-url", BASE, "--bid-id", BID, "--cookie", "session=fake", "--execute", "--storage-only"])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--domain/);
  });

  test("invalid --domain value refuses, zero fetch calls", async () => {
    await expect(
      runMain([
        "--domain", "not-a-real-domain",
        "--base-url", BASE, "--bid-id", BID,
        "--cookie", "session=fake", "--execute", "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--domain must be one of/);
  });

  test("everything supplied except --storage-only — dry run, zero fetch calls", async () => {
    await expect(
      runMain(["--domain", "drawings", "--base-url", BASE, "--bid-id", BID, "--cookie", "session=fake", "--execute"])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--storage-only/);
  });

  test("--base-url not referencing a staging host is refused for a real run, no fetch call", async () => {
    await expect(
      runMain([
        "--domain", "drawings",
        "--base-url", "https://groundworx.neuroglitch.ai", // production hostname, no "staging"
        "--bid-id", BID, "--cookie", "session=fake", "--execute", "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/staging/);
  });

  test("missing auth input (no --cookie/--bearer) refuses even with --execute --storage-only", async () => {
    await expect(
      runMain(["--domain", "drawings", "--base-url", BASE, "--bid-id", BID, "--execute", "--storage-only"])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--cookie/);
  });

  test("--domain estimates without --subcontractor-id refuses, no fetch call", async () => {
    await expect(
      runMain([
        "--domain", "estimates",
        "--base-url", BASE, "--bid-id", BID,
        "--cookie", "session=fake", "--execute", "--storage-only",
      ])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/--subcontractor-id/);
  });

  test("--execute --storage-only --cookie <value> directly is rejected in favor of --cookie-prompt, before any network action", async () => {
    const secretCookie = "authjs.session-token=should-never-reach-a-network-call";
    await expect(
      runMain(["--domain", "drawings", "--base-url", BASE, "--bid-id", BID, "--cookie", secretCookie, "--execute", "--storage-only"])
    ).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(fetchMock).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/use --cookie-prompt instead/);
    expect(logged).not.toContain(secretCookie);
  });

  test("non-TTY environment with --execute --storage-only --cookie-prompt refuses before any network action", async () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    (process.stdin as unknown as { isTTY?: boolean }).isTTY = false;
    (process.stdout as unknown as { isTTY?: boolean }).isTTY = false;
    try {
      await expect(
        runMain(["--domain", "drawings", "--base-url", BASE, "--bid-id", BID, "--cookie-prompt", "--execute", "--storage-only"])
      ).rejects.toBeInstanceOf(ProcessExitSentinel);
      expect(fetchMock).not.toHaveBeenCalled();
      const logged = logSpy.mock.calls.flat().join("\n");
      expect(logged).toMatch(/interactive terminal/);
    } finally {
      (process.stdin as unknown as { isTTY?: boolean }).isTTY = originalStdinIsTTY;
      (process.stdout as unknown as { isTTY?: boolean }).isTTY = originalStdoutIsTTY;
    }
  });
});

// ── promptForCookie hidden-input safety — same mechanism/test technique as
// specbook-staging-smoke.test.ts's mandatory test 9e. ───────────────────────
describe("scripts/artifacts-staging-smoke.mjs — promptForCookie hidden-input safety", () => {
  test("the entered value never appears in console output and is never echoed to the fake terminal", async () => {
    const SENTINEL = "ARTIFACTS-COOKIE-SENTINEL-DO-NOT-USE-xyz789";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

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
    expect(listeners.length).toBe(1);
    listeners[0](SENTINEL);
    listeners[0]("\n");

    const resolved = await promptPromise;
    expect(resolved).toBe(SENTINEL);

    for (const chunk of stdoutWrites) {
      expect(chunk).not.toContain(SENTINEL);
    }
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).not.toContain(SENTINEL);
    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(true);
    expect(fakeStdin.setRawMode).toHaveBeenCalledWith(false);

    logSpy.mockRestore();
  });

  test("refuses immediately on a non-TTY stream pair, never attaching a data listener", async () => {
    const fakeStdin = { isTTY: false, on: vi.fn() };
    const fakeStdout = { isTTY: true, write: vi.fn() };
    await expect(promptForCookie({ stdin: fakeStdin, stdout: fakeStdout })).rejects.toThrow(/interactive TTY/);
    expect(fakeStdin.on).not.toHaveBeenCalled();
  });
});

// ── Full-run behavior per domain — routes fetch by URL/method to canned
// responses matching each route's real shape, and stubs the interactive
// cookie prompt exactly like specbook-staging-smoke.test.ts's test 10 suite.
describe("scripts/artifacts-staging-smoke.mjs — full per-domain runs", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let exitSpy: ReturnType<typeof stubProcessExit>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let originalStdinIsTTY: boolean | undefined;
  let originalStdoutIsTTY: boolean | undefined;
  let originalStdinMethods: Record<string, unknown>;
  let originalStdoutWrite: unknown;

  const COOKIE_VALUE = "authjs.session-token=full-run-test-cookie";
  const ARTIFACT_ID = 90210111;

  function makeResponse(r: { status: number; json?: unknown; headers?: Record<string, string> }) {
    return {
      status: r.status,
      json: async () => (r.json === undefined ? null : r.json),
      headers: { get: (k: string) => r.headers?.[k.toLowerCase()] ?? null },
    };
  }

  function preflightHandler(url: string, method: string) {
    if (url === `${BASE}/api/bids/${BID}` && method === "GET") {
      return makeResponse({ status: 200, json: { id: Number(BID) }, headers: { "x-app-env": "staging" } });
    }
    return null;
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
      if (event === "data") queueMicrotask(() => cb(`${COOKIE_VALUE}\n`));
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

  function runArgs(domain: string, extra: string[] = []) {
    return ["--domain", domain, "--base-url", BASE, "--bid-id", BID, "--cookie-prompt", "--execute", "--storage-only", ...extra];
  }

  // ── DRAWINGS — gated ────────────────────────────────────────────────────
  test("drawings: sends the marker header on upload, asserts automationStatus, and self-cleans via DELETE on the upload's own id", async () => {
    fetchMock.mockImplementation(async (url: string, init: Record<string, unknown> = {}) => {
      const method = (init.method as string) || "GET";
      const pre = preflightHandler(url, method);
      if (pre) return pre;
      if (url === `${BASE}/api/bids/${BID}/drawings/upload` && method === "POST") {
        expect((init.headers as Record<string, string>)?.["X-Drawings-Storage-Smoke"]).toBe("1");
        return makeResponse({ status: 201, json: { id: ARTIFACT_ID, automationStatus: "suppressed_for_storage_smoke" } });
      }
      if (url === `${BASE}/api/bids/${BID}/drawings/gaps` && method === "GET") {
        return makeResponse({ status: 200, json: null });
      }
      if (url === `${BASE}/api/bids/${BID}/drawings/${ARTIFACT_ID}` && method === "DELETE") {
        return makeResponse({ status: 204 });
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    await expect(runMain(runArgs("drawings"))).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(0);

    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/PASS\s+1b\. automation suppressed/);
    expect(logged).toMatch(/PASS\s+3\. self-cleanup delete/);
    // The artifact id itself is never printed bare.
    expect(logged).not.toMatch(new RegExp(`\\b${ARTIFACT_ID}\\b`));
    expect(logged).not.toContain(COOKIE_VALUE);

    const deleteCalls = fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === "DELETE");
    expect(deleteCalls.some(([url]) => url === `${BASE}/api/bids/${BID}/drawings/${ARTIFACT_ID}`)).toBe(true);
  });

  test("drawings: automationStatus !== suppressed_for_storage_smoke is recorded FAIL and contributes to a non-zero exit", async () => {
    fetchMock.mockImplementation(async (url: string, init: Record<string, unknown> = {}) => {
      const method = (init.method as string) || "GET";
      const pre = preflightHandler(url, method);
      if (pre) return pre;
      if (url === `${BASE}/api/bids/${BID}/drawings/upload` && method === "POST") {
        return makeResponse({ status: 201, json: { id: ARTIFACT_ID, automationStatus: "triggered" } });
      }
      if (url === `${BASE}/api/bids/${BID}/drawings/gaps`) return makeResponse({ status: 200, json: null });
      if (url === `${BASE}/api/bids/${BID}/drawings/${ARTIFACT_ID}` && method === "DELETE") {
        return makeResponse({ status: 204 });
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    await expect(runMain(runArgs("drawings"))).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(1);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+1b\. automation suppressed/);
    // Cleanup is still attempted even though the assertion failed.
    expect(logged).toMatch(/PASS\s+3\. self-cleanup delete/);
  });

  // ── ADDENDUMS — upload not gated; cleanup DELETE gated (captain's ruling) ─
  test("addendums: no marker on upload, marker sent on the cleanup DELETE, X-Automation-Status response header asserted, self-cleans", async () => {
    const ADDENDUM_ID = 555;
    fetchMock.mockImplementation(async (url: string, init: Record<string, unknown> = {}) => {
      const method = (init.method as string) || "GET";
      const pre = preflightHandler(url, method);
      if (pre) return pre;
      if (url === `${BASE}/api/bids/${BID}/addendums/upload` && method === "POST") {
        // The upload route is confirmed clean/ungated — no smoke marker of
        // any domain is ever sent to it.
        const headerKeys = Object.keys((init.headers as Record<string, string>) ?? {});
        expect(headerKeys.some((k) => /storage-smoke/i.test(k))).toBe(false);
        return makeResponse({ status: 201, json: { id: ADDENDUM_ID, status: "ready" } });
      }
      if (url === `${BASE}/api/bids/${BID}/addendums` && method === "GET") {
        return makeResponse({ status: 200, json: [] });
      }
      if (url === `${BASE}/api/bids/${BID}/addendums/${ADDENDUM_ID}` && method === "DELETE") {
        // The gated cleanup DELETE — the marker header MUST be present here.
        expect((init.headers as Record<string, string>)?.["X-Addendums-Storage-Smoke"]).toBe("1");
        return makeResponse({
          status: 200,
          json: { deleted: true },
          headers: { "x-automation-status": "suppressed_for_storage_smoke" },
        });
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    await expect(runMain(runArgs("addendums"))).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(0);

    const logged = logSpy.mock.calls.flat().join("\n");
    // No upload-gate assertion is logged (the upload route is not gated)...
    expect(logged).not.toMatch(/1b\. automation suppressed/);
    // ...but the cleanup-gate assertion is, and passes.
    expect(logged).toMatch(/PASS\s+3b\. cleanup automation suppressed/);
    expect(logged).toMatch(/PASS\s+3\. self-cleanup delete/);
    expect(logged).not.toMatch(new RegExp(`\\b${ADDENDUM_ID}\\b`));
  });

  test("addendums: missing X-Automation-Status header on the cleanup DELETE is recorded FAIL (loud) and contributes to a non-zero exit", async () => {
    const ADDENDUM_ID = 556;
    fetchMock.mockImplementation(async (url: string, init: Record<string, unknown> = {}) => {
      const method = (init.method as string) || "GET";
      const pre = preflightHandler(url, method);
      if (pre) return pre;
      if (url === `${BASE}/api/bids/${BID}/addendums/upload` && method === "POST") {
        return makeResponse({ status: 201, json: { id: ADDENDUM_ID, status: "ready" } });
      }
      if (url === `${BASE}/api/bids/${BID}/addendums` && method === "GET") {
        return makeResponse({ status: 200, json: [] });
      }
      if (url === `${BASE}/api/bids/${BID}/addendums/${ADDENDUM_ID}` && method === "DELETE") {
        // Delete succeeds but the suppression header is MISSING — e.g. the
        // operator forgot STORAGE_SMOKE_MODE_ENABLED on the server, or ran
        // against a build without the gate. Must be a loud FAIL.
        return makeResponse({ status: 200, json: { deleted: true } });
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    await expect(runMain(runArgs("addendums"))).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(1);

    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/FAIL\s+3b\. cleanup automation suppressed/);
    expect(logged).toMatch(/a real provider call may have just fired/);
  });

  // ── ESTIMATES — not gated, requires --subcontractor-id, NO delete route ───
  test("estimates: requires --subcontractor-id, sends it in the upload form, and skips cleanup with a loud no-delete-endpoint warning", async () => {
    fetchMock.mockImplementation(async (url: string, init: Record<string, unknown> = {}) => {
      const method = (init.method as string) || "GET";
      const pre = preflightHandler(url, method);
      if (pre) return pre;
      if (url === `${BASE}/api/bids/${BID}/estimates` && method === "POST") {
        const form = init.body as FormData;
        expect(form.get("subcontractorId")).toBe("45");
        return makeResponse({ status: 201, json: { id: 777, parseStatus: "complete" } });
      }
      if (url === `${BASE}/api/bids/${BID}/estimates` && method === "GET") {
        return makeResponse({ status: 200, json: [] });
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    await expect(runMain(runArgs("estimates", ["--subcontractor-id", "45"]))).rejects.toBeInstanceOf(ProcessExitSentinel);
    expect(exitSpy).toHaveBeenCalledWith(0);

    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).toMatch(/SKIP.*NO DELETE ENDPOINT EXISTS/);
    // No DELETE call was ever attempted for this domain.
    const deleteCalls = fetchMock.mock.calls.filter(([, init]) => (init as { method?: string })?.method === "DELETE");
    expect(deleteCalls).toHaveLength(0);
  });

  test("no console output contains the interactively-entered cookie value in any successful run", async () => {
    fetchMock.mockImplementation(async (url: string, init: Record<string, unknown> = {}) => {
      const method = (init.method as string) || "GET";
      const pre = preflightHandler(url, method);
      if (pre) return pre;
      if (url === `${BASE}/api/bids/${BID}/drawings/upload` && method === "POST") {
        return makeResponse({ status: 201, json: { id: ARTIFACT_ID, automationStatus: "suppressed_for_storage_smoke" } });
      }
      if (url === `${BASE}/api/bids/${BID}/drawings/gaps`) return makeResponse({ status: 200, json: null });
      if (url === `${BASE}/api/bids/${BID}/drawings/${ARTIFACT_ID}` && method === "DELETE") {
        return makeResponse({ status: 204 });
      }
      throw new Error(`Unexpected fetch call: ${method} ${url}`);
    });

    await expect(runMain(runArgs("drawings"))).rejects.toBeInstanceOf(ProcessExitSentinel);
    const logged = logSpy.mock.calls.flat().join("\n");
    expect(logged).not.toContain(COOKIE_VALUE);
  });
});
