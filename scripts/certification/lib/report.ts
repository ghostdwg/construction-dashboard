// Result-collection and evidence-normalization for the R2 recovery
// certification harness. Two runs of the full pipeline should normalize to
// identical evidence (scenario 22) — this module defines what counts as
// "normalized": scenario PASS/FAIL outcomes and structural facts (counts,
// applied-migration name lists, content digests of fixed-timestamp seed
// data) survive normalization; wall-clock-derived fields (migration
// started_at/finished_at, raw backup-file checksums that embed those
// timestamps, disposable tmpdir paths) are explicitly excluded and never
// silently dropped — every exclusion is named here.

import { writeFileSync } from "node:fs";

export type ScenarioStatus = "PASS" | "FAIL" | "SKIP";

export interface ScenarioResult {
  id: number;
  name: string;
  status: ScenarioStatus;
  detail?: string;
  evidence?: Record<string, unknown>;
}

export interface CertificationReport {
  scenarios: ScenarioResult[];
  databaseType: string;
  generatedAt: string;
}

export function summarize(report: CertificationReport): { pass: number; fail: number; skip: number; overall: ScenarioStatus } {
  const pass = report.scenarios.filter((s) => s.status === "PASS").length;
  const fail = report.scenarios.filter((s) => s.status === "FAIL").length;
  const skip = report.scenarios.filter((s) => s.status === "SKIP").length;
  return { pass, fail, skip, overall: fail > 0 ? "FAIL" : "PASS" };
}

// Fields explicitly excluded from cross-run determinism comparison, and why.
export const NORMALIZATION_EXCLUSIONS = [
  "generatedAt — wall-clock timestamp of the report itself",
  "evidence.*.startedAt / finishedAt — real migration-apply wall-clock time",
  "evidence.*.rawBackupChecksum — backup file bytes include _prisma_migrations wall-clock columns",
  "evidence.*.*Path — disposable os.tmpdir() run-specific paths",
] as const;

export function normalizeForComparison(report: CertificationReport): unknown {
  return report.scenarios.map((s) => {
    const evidence = s.evidence ? { ...s.evidence } : undefined;
    if (evidence) {
      for (const key of Object.keys(evidence)) {
        if (
          key === "startedAt" ||
          key === "finishedAt" ||
          key === "rawBackupChecksum" ||
          key.endsWith("Path") ||
          key === "runId"
        ) {
          delete evidence[key];
        }
      }
    }
    return { id: s.id, name: s.name, status: s.status, evidence };
  });
}

export function writeResultArtifact(path: string, report: CertificationReport): void {
  writeFileSync(path, JSON.stringify(report, null, 2));
}

export function writeHumanSummary(path: string, report: CertificationReport): void {
  const { pass, fail, skip, overall } = summarize(report);
  const lines: string[] = [];
  lines.push(`# GroundWorX R2 Recovery Certification — Summary`);
  lines.push("");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Database type: ${report.databaseType}`);
  lines.push(`Overall: **${overall}** (${pass} PASS / ${fail} FAIL / ${skip} SKIP)`);
  lines.push("");
  lines.push(`| # | Scenario | Status | Detail |`);
  lines.push(`|---|----------|--------|--------|`);
  for (const s of report.scenarios) {
    lines.push(`| ${s.id} | ${s.name} | ${s.status} | ${s.detail ?? ""} |`);
  }
  lines.push("");
  lines.push(`## Normalization exclusions (fields never compared for cross-run determinism)`);
  lines.push("");
  for (const ex of NORMALIZATION_EXCLUSIONS) lines.push(`- ${ex}`);
  writeFileSync(path, lines.join("\n") + "\n");
}
