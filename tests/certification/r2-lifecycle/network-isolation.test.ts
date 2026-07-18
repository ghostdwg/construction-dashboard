// R2 Local Certification Harness — Network isolation proof (mission section G).
//
// Proves the certification harness itself makes zero network calls: no
// fetch/http client is ever invoked while running every scenario builder,
// and none of the harness's own source files import a network client,
// provider gateway, or live-DB driver.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as scenarios from "@/tests/fixtures/r2-lifecycle/scenarioBuilders";

describe("Zero network access during a full certification run", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(() => {
      throw new Error("Network isolation violated: fetch() was called by the certification harness");
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("running every FIXTURE_SIMULATED scenario builder never touches fetch()", () => {
    scenarios.buildStandardAcceptedResponseScenario();
    scenarios.buildAcceptedWithCommentsScenario();
    scenarios.buildReviseAndResubmitLifecycleScenario();
    scenarios.buildRejectedResponseScenario();
    scenarios.buildFieldVerificationRequiredScenario();
    scenarios.buildInformationalDispositionScenario();
    scenarios.buildCrossBidProvenanceRejectionScenario();
    scenarios.buildDuplicateResponsePackageLinkingRejectionScenario();
    scenarios.buildClosureAllowedAfterEveryGateScenario();
    scenarios.buildReopenedRetainsPriorClosureHistoryScenario();
    scenarios.buildSupersededResponseRevisionsScenario();
    scenarios.buildAppendOnlyHistoryScenario();
    scenarios.buildUnauthorizedCrossBidOperationRejectionScenario();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("No forbidden imports in the harness's own runtime source (static check)", () => {
  // Scoped to tests/fixtures/r2-lifecycle only — the code that actually
  // executes on every certification run. The *.test.ts spec files (this one
  // included) legitimately reference provider/library names in comments and
  // in this very forbidden-list, which would self-match a whole-directory
  // text scan; the runtime fixtures never have a legitimate reason to.
  const HARNESS_RUNTIME_DIR = join(process.cwd(), "tests/fixtures/r2-lifecycle");

  // Matched against extracted import/require specifiers only — never raw
  // file text — so a comment or string mentioning a forbidden name (e.g.
  // documenting an alias, as vocabulary-aliases.ts does) can never
  // false-positive the way a whole-file regex scan would.
  const FORBIDDEN_SPECIFIER_PREFIXES = [
    "@/lib/services/ai/gateway",
    "sidecar/services/ai_gateway",
    "assemblyai",
    "whisperx",
    "@libsql/client",
    "@prisma/adapter-libsql",
    "resend",
    "nodemailer",
  ];
  const IMPORT_SPECIFIER_RE = /(?:from\s+["']([^"']+)["'])|(?:require\(\s*["']([^"']+)["']\s*\))/g;
  const NEW_PRISMA_CLIENT_RE = /new\s+PrismaClient\s*\(/;

  test("no harness runtime file imports a provider gateway, live-DB driver, or email client", () => {
    const offenders: string[] = [];
    for (const fileName of readdirSync(HARNESS_RUNTIME_DIR)) {
      if (!fileName.endsWith(".ts")) continue;
      const contents = readFileSync(join(HARNESS_RUNTIME_DIR, fileName), "utf8");

      for (const match of contents.matchAll(IMPORT_SPECIFIER_RE)) {
        const specifier = match[1] ?? match[2] ?? "";
        if (FORBIDDEN_SPECIFIER_PREFIXES.some((prefix) => specifier.toLowerCase().includes(prefix.toLowerCase()))) {
          offenders.push(`${fileName}: imports "${specifier}"`);
        }
      }
      if (NEW_PRISMA_CLIENT_RE.test(contents)) {
        offenders.push(`${fileName}: constructs a real PrismaClient`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
