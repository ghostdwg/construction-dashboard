#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/lib/orchestrator.mjs
//
//  Sequences the full certification run: validate candidate → create
//  disposable worktree → overlay the two independent validation inputs →
//  install/generate → run all gates → prove the candidate is unchanged →
//  prove network isolation → clean up → build the result artifact.
//
//  Exit codes:
//    0 — every gate passed (or was not applicable)
//    1 — invalid candidate or disposable-worktree setup failure
//    2 — overlay failed
//    3 — one or more required gates failed
//    4 — run was interrupted (SIGINT/SIGTERM)
//    5 — cleanup refused to remove an unowned/unmarked directory
// ──────────────────────────────────────────────────────────────────────────────

import { join } from "node:path";
import { validateCandidate, createWorktree, removeWorktree } from "./worktree.mjs";
import { overlayCommitPaths, mergePackageJsonScript, snapshotCandidate, verifyCandidateUnchanged } from "./overlay.mjs";
import {
  resolveComparisonBase,
  gitDiffCheckGate,
  typecheckGate,
  eslintGate,
  vitestGate,
  regressionPackGate,
  lifecycleCertificationGate,
  prismaValidateGate,
  migrationLintGate,
  migrationReplayGate,
  pythonTestsGate,
  installDependencies,
  prismaGenerateStep,
} from "./gates.mjs";
import { runIncrementalUpgradeValidation } from "./upgradeReplay.mjs";
import { withRecordingExec, assertNetworkIsolation } from "./env.mjs";
import { buildResultArtifact, formatSummary } from "./report.mjs";

export const AUTH_REGRESSION_PACK = {
  sha: "29f141bf169a6bda539857401e621d28d5911d2f",
  paths: ["__tests__/r2-regression", "docs/testing/R2_AUTH_REGRESSION_COVERAGE_MATRIX.md"],
};

export const LIFECYCLE_CERTIFICATION_HARNESS = {
  sha: "c25ea1e6f03bbfb8adb951dd6417a31ba1e54f54",
  paths: ["docs/r2", "scripts/certification/run-r2-certification.mjs", "tests/fixtures/r2-lifecycle"],
  packageJsonScriptName: "certify:r2-lifecycle",
  packageJsonScriptValue: "node scripts/certification/run-r2-certification.mjs",
};

const EXIT = { SUCCESS: 0, SETUP_FAILURE: 1, OVERLAY_FAILURE: 2, GATE_FAILURE: 3, INTERRUPTED: 4, CLEANUP_REFUSED: 5 };

function overlaidPathList() {
  return [...AUTH_REGRESSION_PACK.paths, ...LIFECYCLE_CERTIFICATION_HARNESS.paths];
}

/**
 * Pure, directly-testable interruption-handling logic (no process.exit here —
 * that only happens in the real SIGINT/SIGTERM handler that calls this).
 * Honors --keep-worktree; otherwise attempts the same marker-checked removal
 * as a normal run and reports whether cleanup actually succeeded.
 */
export function handleInterruption(signal, worktreeDir, token, keepWorktree, deps, cwd) {
  if (keepWorktree) {
    return {
      exitCode: EXIT.INTERRUPTED,
      summary: `RESULT: INTERRUPTED (${signal})\nWorktree kept at ${worktreeDir} (--keep-worktree).`,
      cleanupResult: { removed: false, reason: "kept", detail: "kept via --keep-worktree" },
    };
  }
  const cleanupResult = removeWorktree(worktreeDir, token, deps, cwd);
  if (!cleanupResult.removed) {
    return {
      exitCode: EXIT.CLEANUP_REFUSED,
      summary: `RESULT: INTERRUPTED (${signal}) — cleanup refused: ${cleanupResult.detail}`,
      cleanupResult,
    };
  }
  return {
    exitCode: EXIT.INTERRUPTED,
    summary: `RESULT: INTERRUPTED (${signal})\nDisposable worktree removed cleanly.`,
    cleanupResult,
  };
}

/** Persists the result artifact to <outputDir>/result-<sha12>.json — the
 *  machine-readable evidence retained even when the run fails. */
function persistArtifact(outputDir, sha, data, deps) {
  try {
    deps.fs.mkdirSync(outputDir, { recursive: true });
    deps.fs.writeFileSync(join(outputDir, `result-${sha.slice(0, 12)}.json`), JSON.stringify(data, null, 2) + "\n");
  } catch {
    // Best-effort: never let artifact persistence failure mask the actual result.
  }
}

export async function runCertification(candidateShaArg, opts, rawDeps) {
  const cwd = opts.repoRoot ?? process.cwd();
  const outputDir = opts.outputDir;
  const { exec: recordingExec, calls } = withRecordingExec(rawDeps.exec);
  const deps = { ...rawDeps, exec: recordingExec };

  const candidate = validateCandidate(candidateShaArg, deps, cwd);
  if (!candidate.ok) {
    return { exitCode: EXIT.SETUP_FAILURE, summary: `CANDIDATE INVALID: ${candidate.detail}`, artifact: null };
  }

  const created = createWorktree(candidate.sha, outputDir, deps, cwd);
  if (!created.ok) {
    return { exitCode: EXIT.SETUP_FAILURE, summary: `SETUP FAILED (${created.reason}): ${created.detail}`, artifact: null };
  }
  const { dir: worktreeDir, token } = created;

  const cleanup = () => {
    if (opts.keepWorktree) return { removed: false, reason: "kept", detail: "kept via --keep-worktree" };
    return removeWorktree(worktreeDir, token, deps, cwd);
  };

  let cleaningUp = false;
  const onSignal = (signal) => {
    if (cleaningUp) return;
    cleaningUp = true;
    const { exitCode, summary } = handleInterruption(signal, worktreeDir, token, opts.keepWorktree, deps, cwd);
    console.log(summary);
    process.exit(exitCode);
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  try {
    const before = snapshotCandidate(worktreeDir, deps);

    const overlayAuth = overlayCommitPaths(worktreeDir, AUTH_REGRESSION_PACK.sha, AUTH_REGRESSION_PACK.paths, deps);
    if (!overlayAuth.ok) {
      const cleanupResult = cleanup();
      const artifact = { candidate: candidate.sha, result: "FAIL", stage: "overlay", detail: overlayAuth.detail };
      persistArtifact(outputDir, candidate.sha, artifact, deps);
      return { exitCode: EXIT.OVERLAY_FAILURE, summary: `OVERLAY FAILED: ${overlayAuth.detail}`, artifact, cleanupResult };
    }
    const overlayHarness = overlayCommitPaths(worktreeDir, LIFECYCLE_CERTIFICATION_HARNESS.sha, LIFECYCLE_CERTIFICATION_HARNESS.paths, deps);
    if (!overlayHarness.ok) {
      const cleanupResult = cleanup();
      const artifact = { candidate: candidate.sha, result: "FAIL", stage: "overlay", detail: overlayHarness.detail };
      persistArtifact(outputDir, candidate.sha, artifact, deps);
      return { exitCode: EXIT.OVERLAY_FAILURE, summary: `OVERLAY FAILED: ${overlayHarness.detail}`, artifact, cleanupResult };
    }
    const mergedScript = mergePackageJsonScript(
      worktreeDir,
      LIFECYCLE_CERTIFICATION_HARNESS.packageJsonScriptName,
      LIFECYCLE_CERTIFICATION_HARNESS.packageJsonScriptValue,
      deps
    );
    if (!mergedScript.ok) {
      const cleanupResult = cleanup();
      const artifact = { candidate: candidate.sha, result: "FAIL", stage: "overlay", detail: mergedScript.detail };
      persistArtifact(outputDir, candidate.sha, artifact, deps);
      return { exitCode: EXIT.OVERLAY_FAILURE, summary: `OVERLAY FAILED: ${mergedScript.detail}`, artifact, cleanupResult };
    }

    const gateResults = [];
    gateResults.push(installDependencies(worktreeDir, deps, opts.skipInstall));
    gateResults.push(prismaGenerateStep(worktreeDir, deps));

    const base = resolveComparisonBase(worktreeDir, deps);

    gateResults.push(gitDiffCheckGate(worktreeDir, deps));
    gateResults.push(typecheckGate(worktreeDir, deps));
    gateResults.push(eslintGate(worktreeDir, deps, base));

    const vitestResult = vitestGate(worktreeDir, deps);
    gateResults.push(vitestResult);
    gateResults.push(regressionPackGate(worktreeDir, deps, vitestResult));

    gateResults.push(lifecycleCertificationGate(worktreeDir, deps));
    gateResults.push(prismaValidateGate(worktreeDir, deps));
    gateResults.push(migrationLintGate(worktreeDir, deps));
    gateResults.push(migrationReplayGate(worktreeDir, deps));
    gateResults.push(await runIncrementalUpgradeValidation(worktreeDir, deps));
    gateResults.push(pythonTestsGate(worktreeDir, deps, base));

    const unchanged = verifyCandidateUnchanged(
      worktreeDir,
      before,
      overlaidPathList(),
      LIFECYCLE_CERTIFICATION_HARNESS.packageJsonScriptName,
      deps
    );

    const networkViolations = assertNetworkIsolation(calls);

    const cleanupResult = cleanup();
    const removalFailedUnexpectedly = !opts.keepWorktree && !cleanupResult.removed;

    const artifact = buildResultArtifact({
      candidateSha: candidate.sha,
      gateResults,
      sourceUnchanged: unchanged.unchanged,
      networkViolations,
      artifactDirectory: outputDir,
      keptWorktree: !!opts.keepWorktree,
    });
    if (!unchanged.unchanged) {
      artifact.result = "FAIL";
      artifact.sourceCandidateModifiedDetail = unchanged.detail;
    }

    let exitCode = artifact.result === "PASS" ? EXIT.SUCCESS : EXIT.GATE_FAILURE;
    if (removalFailedUnexpectedly) exitCode = EXIT.CLEANUP_REFUSED;

    persistArtifact(outputDir, candidate.sha, artifact, deps);

    return { exitCode, summary: formatSummary(artifact), artifact, cleanupResult };
  } finally {
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  }
}

export { EXIT };
