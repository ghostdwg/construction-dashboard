#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/lib/report.mjs
//
//  Builds the machine-readable JSON result artifact and the human-readable
//  summary block (the exact field list requested for this tool's output).
// ──────────────────────────────────────────────────────────────────────────────

function gateStatusOf(gateResults, name) {
  const g = gateResults.find((r) => r.name === name);
  return g ? g.status : "skip";
}

function gateDetailOf(gateResults, name) {
  const g = gateResults.find((r) => r.name === name);
  return g ? g.detail : "gate did not run";
}

/** true if every gate that ran is pass or skip — a single "fail" fails the whole run. */
export function overallPassed(gateResults) {
  return gateResults.every((r) => r.status !== "fail");
}

export function buildResultArtifact({ candidateSha, gateResults, sourceUnchanged, networkViolations, artifactDirectory, keptWorktree }) {
  const passed = overallPassed(gateResults);
  return {
    candidate: candidateSha,
    result: passed ? "PASS" : "FAIL",
    gates: gateResults,
    sourceCandidateModified: !sourceUnchanged,
    externalNetworkRequired: networkViolations.length > 0,
    networkViolations,
    artifactDirectory,
    keptWorktree,
    generatedAt: new Date().toISOString(),
  };
}

export function formatSummary(artifact) {
  const g = artifact.gates;
  const lines = [
    `CANDIDATE: ${artifact.candidate}`,
    `RESULT: ${artifact.result}`,
    `FULL_VITEST: ${gateStatusOf(g, "FULL_VITEST").toUpperCase()}`,
    `REGRESSION_PACK: ${gateStatusOf(g, "REGRESSION_PACK").toUpperCase()}`,
    `LIFECYCLE_CERTIFICATION: ${gateStatusOf(g, "LIFECYCLE_CERTIFICATION").toUpperCase()}`,
    `TYPECHECK: ${gateStatusOf(g, "TYPECHECK").toUpperCase()}`,
    `ESLINT: ${gateStatusOf(g, "ESLINT").toUpperCase()}`,
    `PRISMA_VALIDATE: ${gateStatusOf(g, "PRISMA_VALIDATE").toUpperCase()}`,
    `MIGRATION_LINT: ${gateStatusOf(g, "MIGRATION_LINT").toUpperCase()}`,
    `MIGRATION_REPLAY: ${gateStatusOf(g, "MIGRATION_REPLAY").toUpperCase()}`,
    `MIGRATION_UPGRADE_VALIDATION: ${gateStatusOf(g, "MIGRATION_UPGRADE_VALIDATION").toUpperCase()}`,
    `PYTHON_TESTS: ${gateStatusOf(g, "PYTHON_TESTS").toUpperCase()}`,
    `SOURCE_CANDIDATE_MODIFIED: ${artifact.sourceCandidateModified}`,
    `EXTERNAL_NETWORK_REQUIRED: ${artifact.externalNetworkRequired}`,
    `ARTIFACT_DIRECTORY: ${artifact.artifactDirectory}`,
  ];
  const failed = g.filter((r) => r.status === "fail");
  if (failed.length > 0) {
    lines.push("", "FAILED GATES:");
    for (const f of failed) {
      lines.push(`  - ${f.name}: ${gateDetailOf(g, f.name).split("\n")[0]}`);
    }
  }
  return lines.join("\n");
}
