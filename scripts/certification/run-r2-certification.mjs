#!/usr/bin/env node
// scripts/certification/run-r2-certification.mjs
//
// THE one operator command for the GroundWorX R2 local Meeting-to-Response
// certification harness (docs/r2/LOCAL-CERTIFICATION-HARNESS.md).
//
// Guarantees:
//   - synthetic data only (tests/fixtures/r2-lifecycle/, reusing
//     tests/field-response-certification/ where a capability is IMPLEMENTED);
//   - no secrets required — sets no credential env var;
//   - no network access — see the "Zero network access" test in
//     tests/certification/r2-lifecycle/network-isolation.test.ts;
//   - in-memory substitute "database" (no Prisma client instantiated, no
//     SQLite file touched) — every scenario builder resets its own id
//     counters and uses a fixed clock, so setup is deterministic by
//     construction; there is no on-disk or DB state to tear down, and the
//     one on-disk artifact this script itself creates (the JSON results
///    file) is deleted at both start and end — that is this script's
//     deterministic cleanup;
//   - nonzero exit on any real certification failure (the underlying
//     `vitest run` exit code is propagated verbatim);
//   - a concise scenario-by-scenario summary with capability labels.
//
// Usage: node scripts/certification/run-r2-certification.mjs
//    or: npm run certify:r2-lifecycle

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const TEST_DIR = "tests/certification/r2-lifecycle/";
const RESULTS_FILE = path.join(REPO_ROOT, ".r2-certification-result.json");

/** Scenario number + one-line capability label, keyed by the leading
 *  "Scenario N — ..." text every certification describe() block uses.
 *  Kept in this script (not derived) so the operator-facing summary never
 *  silently drops a scenario if a describe title is edited without this
 *  file being updated in the same review. */
const SCENARIO_CAPABILITY = {
  1: "FIXTURE_SIMULATED",
  2: "FIXTURE_SIMULATED",
  3: "FIXTURE_SIMULATED + IMPLEMENTED",
  4: "FIXTURE_SIMULATED",
  5: "FIXTURE_SIMULATED",
  6: "FIXTURE_SIMULATED",
  7: "FIXTURE_SIMULATED",
  8: "IMPLEMENTED",
  9: "IMPLEMENTED",
  10: "FIXTURE_SIMULATED",
  11: "HARNESS DETERMINISM",
  12: "HARNESS DETERMINISM",
  13: "FIXTURE_SIMULATED",
  14: "FIXTURE_SIMULATED",
  15: "FIXTURE_SIMULATED",
  16: "FIXTURE_SIMULATED",
  17: "FIXTURE_SIMULATED",
  18: "FIXTURE_SIMULATED",
  19: "FIXTURE_SIMULATED",
  20: "HARNESS DETERMINISM",
  21: "IMPLEMENTED",
  22: "IMPLEMENTED",
  23: "FIXTURE_SIMULATED",
  24: "FIXTURE_SIMULATED",
  25: "FIXTURE_SIMULATED",
  26: "FIXTURE_SIMULATED",
};
const TOTAL_SCENARIOS = 26;

function cleanupResultsFile() {
  if (existsSync(RESULTS_FILE)) unlinkSync(RESULTS_FILE);
}

function extractScenarioNumber(describeTitle) {
  const match = /^Scenario (\d+)/.exec(describeTitle ?? "");
  return match ? Number(match[1]) : null;
}

function main() {
  cleanupResultsFile(); // deterministic start: never read a stale prior run's file

  console.log("── GroundWorX R2 Local Certification Harness ──────────────────────────────");
  console.log("Local-only · synthetic data · no network · no credentials · in-memory substitute DB");
  console.log("");

  const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  const spawned = spawnSync(
    npxBin,
    ["vitest", "run", TEST_DIR, "--reporter=json", `--outputFile=${RESULTS_FILE}`],
    { cwd: REPO_ROOT, encoding: "utf8" }
  );

  if (!existsSync(RESULTS_FILE)) {
    console.error("FAIL: vitest produced no results file. Raw output follows:");
    console.error(spawned.stdout);
    console.error(spawned.stderr);
    process.exit(spawned.status ?? 1);
  }

  const report = JSON.parse(readFileSync(RESULTS_FILE, "utf8"));
  const byScenario = new Map();
  const infra = [];

  for (const suite of report.testResults ?? []) {
    for (const assertion of suite.assertionResults ?? []) {
      const topDescribe = assertion.ancestorTitles?.[0] ?? "";
      const scenarioNumber = extractScenarioNumber(topDescribe);
      const entry = { title: assertion.title, status: assertion.status, describe: topDescribe };
      if (scenarioNumber !== null) {
        if (!byScenario.has(scenarioNumber)) byScenario.set(scenarioNumber, []);
        byScenario.get(scenarioNumber).push(entry);
      } else {
        infra.push(entry);
      }
    }
  }

  console.log("Scenario-by-scenario results:");
  console.log("");
  let anyScenarioFailed = false;
  for (let n = 1; n <= TOTAL_SCENARIOS; n++) {
    const entries = byScenario.get(n) ?? [];
    const failed = entries.filter((e) => e.status !== "passed");
    if (failed.length > 0) anyScenarioFailed = true;
    const status = entries.length === 0 ? "MISSING" : failed.length > 0 ? "FAIL" : "PASS";
    const label = SCENARIO_CAPABILITY[n] ?? "UNKNOWN";
    console.log(
      `  [${status.padEnd(7)}] Scenario ${String(n).padEnd(2)} (${label.padEnd(28)}) — ${entries.length} assertion(s)`
    );
    if (status === "MISSING") anyScenarioFailed = true;
  }

  console.log("");
  console.log("Infrastructure checks (network isolation, credential-free, structural proofs):");
  const infraFailed = infra.filter((e) => e.status !== "passed");
  for (const entry of infra) {
    console.log(`  [${entry.status === "passed" ? "PASS   " : "FAIL   "}] ${entry.describe} :: ${entry.title}`);
  }

  console.log("");
  const totals = report.testResults?.flatMap((s) => s.assertionResults ?? []) ?? [];
  const passedCount = totals.filter((t) => t.status === "passed").length;
  console.log(`Total: ${passedCount}/${totals.length} assertions passed across ${TOTAL_SCENARIOS} required scenarios.`);

  const success = spawned.status === 0 && !anyScenarioFailed && infraFailed.length === 0;
  console.log(success ? "CERTIFICATION RESULT: PASS" : "CERTIFICATION RESULT: FAIL");
  console.log("─────────────────────────────────────────────────────────────────────────");

  cleanupResultsFile(); // deterministic end: no artifact left on disk

  process.exit(success ? 0 : spawned.status && spawned.status !== 0 ? spawned.status : 1);
}

main();
