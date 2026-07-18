#!/usr/bin/env tsx
// GroundWorX R2 recovery certification — local-only, disposable-database
// harness. Proves the current migration chain can initialize, upgrade,
// back up, restore, and detect unsafe recovery states. Never touches
// staging/production/Turso/credentials/network. See
// docs/r2/R2-RECOVERY-CERTIFICATION.md for the full procedure and how to
// interpret a failure.
//
// Usage: npm run certify:r2-recovery [-- --keep]
//   --keep   do not delete the disposable os.tmpdir() run directories
//            (useful for inspecting a failure by hand)

import { copyFileSync, existsSync, readFileSync, writeFileSync, truncateSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCertRun, cleanupCertRun, dbPath, backupPath, type CertRun } from "./lib/paths";
import { listMigrations, applyMigrations, auditMigrationState, simulate } from "./lib/migrator";
import { createBackup, restoreBackup, readManifest, verifyRestoredIntegrity } from "./lib/backup";
import { seedBaseline, seedResponsePackageEra, type BaselineIds } from "./lib/fixtures";
import { tableRowCounts, foreignKeyCheck, integrityCheckOk, contentDigest, listTables } from "./lib/integrity";
import {
  writeResultArtifact,
  writeHumanSummary,
  normalizeForComparison,
  summarize,
  type CertificationReport,
  type ScenarioResult,
  type ScenarioStatus,
} from "./lib/report";
import { sha256File, sha256Json } from "./lib/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const KEEP = process.argv.includes("--keep");

function rec(
  scenarios: ScenarioResult[],
  id: number,
  name: string,
  status: ScenarioStatus,
  detail?: string,
  evidence?: Record<string, unknown>
): void {
  scenarios.push({ id, name, status, detail, evidence });
}

async function runPipeline(label: string): Promise<{ report: CertificationReport; run: CertRun }> {
  const scenarios: ScenarioResult[] = [];
  const run = createCertRun(label);
  const all = listMigrations();
  const total = all.length;
  const TAIL = 3; // "migrations 99, 100, 101" == the last 3 of the current 101-migration chain
  const baselineLimit = total - TAIL;
  if (baselineLimit < 1) {
    throw new Error(`migration chain too short for a ${TAIL}-migration tail scenario (found ${total})`);
  }

  // ── Scenario 1: fresh empty database migration through the full chain ──
  const freshDb = dbPath(run, "fresh");
  const freshApply = await applyMigrations(freshDb);
  if (freshApply.status === "ok" && freshApply.appliedNow.length === total) {
    const okIntegrity = await integrityCheckOk(freshDb);
    const fkViolations = await foreignKeyCheck(freshDb);
    const pass = okIntegrity && fkViolations.length === 0;
    rec(
      scenarios,
      1,
      "fresh empty database migration through full chain",
      pass ? "PASS" : "FAIL",
      pass ? `applied ${total} migrations` : `integrity_check=${okIntegrity}, fk violations=${fkViolations.length}`,
      { appliedCount: freshApply.appliedCount, totalOnDisk: total }
    );
  } else {
    rec(scenarios, 1, "fresh empty database migration through full chain", "FAIL", JSON.stringify(freshApply));
  }

  // ── Scenario 2: seeded pre-99 database upgraded through 99→100→101 ──
  const upgradeDb = dbPath(run, "upgrade");
  let baseIds: BaselineIds | undefined;
  const tailBackup = backupPath(run, "pre-tail");
  try {
    const baselineApply = await applyMigrations(upgradeDb, { limit: baselineLimit });
    if (baselineApply.status !== "ok" || baselineApply.appliedNow.length !== baselineLimit) {
      throw new Error(`baseline apply failed: ${JSON.stringify(baselineApply)}`);
    }
    baseIds = await seedBaseline(upgradeDb);
    const preCounts = await tableRowCounts(upgradeDb, [
      "Trade",
      "Subcontractor",
      "Bid",
      "Meeting",
      "MeetingRegisterEntry",
      "MeetingRegisterEntryRevision",
      "MeetingCommitment",
      "TrackedItem",
      "TrackedItemAttachment",
      "BackgroundJob",
      "AuditEvent",
    ]);
    const preDigest = await contentDigest(upgradeDb, "TrackedItem", ["id", "bidId", "kind", "title", "status"]);

    // Snapshot the schema just before the tail — used later by scenario 17
    // (wrong-schema-version restore refusal); its manifest.lastMigration
    // will read back as all[baselineLimit - 1].
    await createBackup(upgradeDb, tailBackup);

    const step99 = await applyMigrations(upgradeDb, { limit: 1 });
    if (step99.status !== "ok" || step99.appliedNow.length !== 1) {
      throw new Error(`migration 99 apply failed: ${JSON.stringify(step99)}`);
    }
    const rpIds = await seedResponsePackageEra(upgradeDb, baseIds);

    const stepRest = await applyMigrations(upgradeDb);
    if (stepRest.status !== "ok" || stepRest.appliedNow.length !== TAIL - 1) {
      throw new Error(`migrations 100-101 apply failed: ${JSON.stringify(stepRest)}`);
    }

    const postCounts = await tableRowCounts(upgradeDb, Object.keys(preCounts));
    const postDigest = await contentDigest(upgradeDb, "TrackedItem", ["id", "bidId", "kind", "title", "status"]);
    const countsPreserved = JSON.stringify(preCounts) === JSON.stringify(postCounts);
    const digestPreserved = preDigest === postDigest;

    const backfilled = await tableRowCounts(upgradeDb, ["TradeResponseReviewDecision"]);
    const backfillRow = await contentDigest(upgradeDb, "TradeResponseReviewDecision", [
      "responseRevisionId",
      "decision",
      "reviewedBy",
      "commentary",
    ]);
    const expectedBackfillDigest = sha256Json([
      [rpIds.tradeResponseRevisionId, "APPROVED", "[CERT] Synthetic Reviewer", "[CERT] synthetic reviewer commentary"],
    ]);
    const backfillOk = backfilled.TradeResponseReviewDecision === 1 && backfillRow === expectedBackfillDigest;

    const pass = countsPreserved && digestPreserved && backfillOk;
    rec(
      scenarios,
      2,
      "seeded pre-99 database upgraded through 99→100→101",
      pass ? "PASS" : "FAIL",
      pass
        ? "baseline rows preserved, response-package chain and migration-101 review-decision backfill verified"
        : `countsPreserved=${countsPreserved} digestPreserved=${digestPreserved} backfillOk=${backfillOk}`,
      { preCounts, postCounts, backfillCount: backfilled.TradeResponseReviewDecision, tailMigrations: all.slice(baselineLimit) }
    );
  } catch (err) {
    rec(scenarios, 2, "seeded pre-99 database upgraded through 99→100→101", "FAIL", err instanceof Error ? err.message : String(err));
  }

  // ── Scenario 3: migration-order verification ──
  {
    const audit = await auditMigrationState(freshDb);
    const sorted = [...audit.appliedNames].sort();
    const inOrder = JSON.stringify(audit.appliedNames) === JSON.stringify(sorted);
    const complete = audit.appliedNames.length === total && audit.missing.length === 0 && audit.unknown.length === 0;
    const pass = inOrder && complete;
    rec(
      scenarios,
      3,
      "migration-order verification",
      pass ? "PASS" : "FAIL",
      pass ? `${total} migrations applied in lexicographic order` : `inOrder=${inOrder} complete=${complete}`
    );
  }

  // ── Scenario 4: repeated migration command is safe ──
  {
    const before = await auditMigrationState(freshDb);
    const repeat = await applyMigrations(freshDb);
    const after = await auditMigrationState(freshDb);
    const pass =
      repeat.status === "ok" &&
      repeat.appliedNow.length === 0 &&
      after.appliedCount === before.appliedCount &&
      after.appliedCount === total;
    rec(
      scenarios,
      4,
      "repeated migration command is safe",
      pass ? "PASS" : "FAIL",
      pass ? "second run applied 0 pending migrations, no duplicate rows" : JSON.stringify({ repeat, before, after })
    );
  }

  // ── Scenario 5 + 6: backup creation + checksum ──
  const fullBackup = backupPath(run, "full");
  try {
    const manifest = await createBackup(upgradeDb, fullBackup);
    rec(scenarios, 5, "backup creation", "PASS", `backup at ${manifest.byteSize} bytes, schema at ${manifest.lastMigration}`);
    const recomputed = sha256File(fullBackup);
    const pass = recomputed === manifest.checksum;
    rec(scenarios, 6, "backup checksum", pass ? "PASS" : "FAIL", pass ? "recomputed checksum matches manifest" : "checksum mismatch");
  } catch (err) {
    rec(scenarios, 5, "backup creation", "FAIL", err instanceof Error ? err.message : String(err));
    rec(scenarios, 6, "backup checksum", "SKIP", "backup creation failed");
  }

  // ── Scenario 7: restore into a second disposable database ──
  const restoredDb = dbPath(run, "restored");
  let restoreOk = false;
  try {
    const res = restoreBackup(fullBackup, restoredDb);
    restoreOk = res.status === "ok";
    rec(scenarios, 7, "restore into a second disposable database", restoreOk ? "PASS" : "FAIL", JSON.stringify(res).slice(0, 300));
  } catch (err) {
    rec(scenarios, 7, "restore into a second disposable database", "FAIL", err instanceof Error ? err.message : String(err));
  }

  const skipIfNoRestore = (id: number, name: string) => rec(scenarios, id, name, "SKIP", "restore (scenario 7) did not succeed");

  if (restoreOk) {
    // ── Scenario 8: row-count comparison ──
    try {
      const tables = await listTables(upgradeDb);
      const src = await tableRowCounts(upgradeDb, tables);
      const dst = await tableRowCounts(restoredDb, tables);
      const pass = JSON.stringify(src) === JSON.stringify(dst);
      rec(scenarios, 8, "row-count comparison", pass ? "PASS" : "FAIL", pass ? `${tables.length} tables compared` : "row counts diverged", {
        tableCount: tables.length,
      });
    } catch (err) {
      rec(scenarios, 8, "row-count comparison", "FAIL", err instanceof Error ? err.message : String(err));
    }

    // ── Scenario 9: foreign-key integrity ──
    try {
      const violations = await foreignKeyCheck(restoredDb);
      rec(scenarios, 9, "foreign-key integrity", violations.length === 0 ? "PASS" : "FAIL", `${violations.length} violation(s)`);
    } catch (err) {
      rec(scenarios, 9, "foreign-key integrity", "FAIL", err instanceof Error ? err.message : String(err));
    }

    // ── Scenario 10: immutable history preserved (AuditEvent) ──
    try {
      const cols = ["id", "category", "action", "decision", "emittedAt"];
      const srcDigest = await contentDigest(upgradeDb, "AuditEvent", cols);
      const dstDigest = await contentDigest(restoredDb, "AuditEvent", cols);
      rec(scenarios, 10, "immutable history preserved (AuditEvent)", srcDigest === dstDigest ? "PASS" : "FAIL");
    } catch (err) {
      rec(scenarios, 10, "immutable history preserved (AuditEvent)", "FAIL", err instanceof Error ? err.message : String(err));
    }

    // ── Scenario 11: audit rows preserved (register-entry + review-decision trails) ──
    try {
      const revCols = ["id", "entryId", "bidId", "changeType", "actor"];
      const srcRev = await contentDigest(upgradeDb, "MeetingRegisterEntryRevision", revCols);
      const dstRev = await contentDigest(restoredDb, "MeetingRegisterEntryRevision", revCols);
      const decCols = ["id", "responseRevisionId", "decision", "reviewedBy", "commentary"];
      const srcDec = await contentDigest(upgradeDb, "TradeResponseReviewDecision", decCols);
      const dstDec = await contentDigest(restoredDb, "TradeResponseReviewDecision", decCols);
      const pass = srcRev === dstRev && srcDec === dstDec;
      rec(scenarios, 11, "audit rows preserved (register revisions + review decisions)", pass ? "PASS" : "FAIL");
    } catch (err) {
      rec(scenarios, 11, "audit rows preserved (register revisions + review decisions)", "FAIL", err instanceof Error ? err.message : String(err));
    }

    // ── Scenario 12: Meeting/Register/TrackedItem provenance preserved ──
    try {
      const meetingCols = ["id", "bidId", "title", "meetingType", "status"];
      const registerCols = ["id", "meetingId", "bidId", "entryType", "origin", "rawSourceText", "normalizedText"];
      const trackedCols = ["id", "bidId", "kind", "title", "sourceKind", "extractionMethod"];
      const pass =
        (await contentDigest(upgradeDb, "Meeting", meetingCols)) === (await contentDigest(restoredDb, "Meeting", meetingCols)) &&
        (await contentDigest(upgradeDb, "MeetingRegisterEntry", registerCols)) ===
          (await contentDigest(restoredDb, "MeetingRegisterEntry", registerCols)) &&
        (await contentDigest(upgradeDb, "TrackedItem", trackedCols)) === (await contentDigest(restoredDb, "TrackedItem", trackedCols));
      rec(scenarios, 12, "Meeting/Register/TrackedItem provenance preserved", pass ? "PASS" : "FAIL");
    } catch (err) {
      rec(scenarios, 12, "Meeting/Register/TrackedItem provenance preserved", "FAIL", err instanceof Error ? err.message : String(err));
    }

    // ── Scenario 13: response-package relationships preserved ──
    try {
      const chainSql = `
        SELECT COUNT(*) as n FROM "ResponsePackage" p
        JOIN "ResponsePackageItem" i ON i."packageId" = p."id"
        JOIN "TradeResponseRevision" r ON r."packageItemId" = i."id"
        JOIN "TradeResponseAttachment" a ON a."responseRevisionId" = r."id"
        JOIN "TradeResponseReviewDecision" d ON d."responseRevisionId" = r."id"
      `;
      const { scalarQuery } = await import("./lib/integrity");
      const srcChain = await scalarQuery<{ n: number }>(upgradeDb, chainSql);
      const dstChain = await scalarQuery<{ n: number }>(restoredDb, chainSql);
      const srcN = Number(srcChain[0]?.n ?? 0);
      const dstN = Number(dstChain[0]?.n ?? 0);
      const pass = srcN > 0 && srcN === dstN;
      rec(
        scenarios,
        13,
        "response-package relationships preserved where present",
        pass ? "PASS" : "FAIL",
        `full chain rows: source=${srcN} restored=${dstN}`
      );
    } catch (err) {
      rec(scenarios, 13, "response-package relationships preserved where present", "FAIL", err instanceof Error ? err.message : String(err));
    }

    // ── Scenario 14: attachment/storage references preserved ──
    try {
      const trackedAttCols = ["id", "trackedItemId", "storageKey", "fileName", "mimeType", "byteSize"];
      const tradeAttCols = ["id", "responseRevisionId", "storageKey", "fileName", "mimeType", "byteSize"];
      const pass =
        (await contentDigest(upgradeDb, "TrackedItemAttachment", trackedAttCols)) ===
          (await contentDigest(restoredDb, "TrackedItemAttachment", trackedAttCols)) &&
        (await contentDigest(upgradeDb, "TradeResponseAttachment", tradeAttCols)) ===
          (await contentDigest(restoredDb, "TradeResponseAttachment", tradeAttCols));
      rec(scenarios, 14, "attachment/storage references preserved", pass ? "PASS" : "FAIL");
    } catch (err) {
      rec(scenarios, 14, "attachment/storage references preserved", "FAIL", err instanceof Error ? err.message : String(err));
    }

    // ── Scenario 15: BackgroundJob state preserved ──
    try {
      const cols = ["id", "jobType", "bidId", "status"];
      const pass = (await contentDigest(upgradeDb, "BackgroundJob", cols)) === (await contentDigest(restoredDb, "BackgroundJob", cols));
      rec(scenarios, 15, "BackgroundJob state preserved", pass ? "PASS" : "FAIL");
    } catch (err) {
      rec(scenarios, 15, "BackgroundJob state preserved", "FAIL", err instanceof Error ? err.message : String(err));
    }
  } else {
    for (const [id, name] of [
      [8, "row-count comparison"],
      [9, "foreign-key integrity"],
      [10, "immutable history preserved (AuditEvent)"],
      [11, "audit rows preserved (register revisions + review decisions)"],
      [12, "Meeting/Register/TrackedItem provenance preserved"],
      [13, "response-package relationships preserved where present"],
      [14, "attachment/storage references preserved"],
      [15, "BackgroundJob state preserved"],
    ] as [number, string][]) {
      skipIfNoRestore(id, name);
    }
  }

  // ── Scenario 16: restoration from a corrupted backup is refused ──
  try {
    const corruptBackup = backupPath(run, "corrupt");
    copyFileSync(fullBackup, corruptBackup);
    copyFileSync(`${fullBackup}.manifest.json`, `${corruptBackup}.manifest.json`);
    // Flip bytes in the middle of the copy without touching its manifest,
    // so the manifest's checksum no longer matches the (corrupted) file.
    const buf = readFileSync(corruptBackup);
    buf[Math.floor(buf.length / 2)] ^= 0xff;
    writeFileSync(corruptBackup, buf);
    const target = dbPath(run, "from-corrupt");
    const res = restoreBackup(corruptBackup, target);
    const pass = res.status === "refused" && res.reason === "checksum-mismatch" && !existsSync(target);
    rec(scenarios, 16, "restoration from a corrupted backup is refused", pass ? "PASS" : "FAIL", JSON.stringify(res).slice(0, 200));
  } catch (err) {
    rec(scenarios, 16, "restoration from a corrupted backup is refused", "FAIL", err instanceof Error ? err.message : String(err));
  }

  // ── Scenario 17: restoration from the wrong schema version is refused ──
  try {
    const target = dbPath(run, "wrong-schema");
    const expectedSchemaVersion = all[all.length - 1]; // the fully-migrated tail
    const res = restoreBackup(tailBackup, target, { expectedSchemaVersion });
    const pass = res.status === "refused" && res.reason === "schema-version-mismatch" && !existsSync(target);
    rec(
      scenarios,
      17,
      "restoration from the wrong schema version is refused or clearly gated",
      pass ? "PASS" : "FAIL",
      JSON.stringify(res).slice(0, 300)
    );
  } catch (err) {
    rec(scenarios, 17, "restoration from the wrong schema version is refused or clearly gated", "FAIL", err instanceof Error ? err.message : String(err));
  }

  // ── Scenario 18: interrupted migration state is detected ──
  try {
    const interruptedDb = dbPath(run, "interrupted");
    const partialLimit = await applyMigrations(interruptedDb, { limit: baselineLimit });
    if (partialLimit.status !== "ok") throw new Error(`setup failed: ${JSON.stringify(partialLimit)}`);
    await simulate.markPartial(interruptedDb, all[baselineLimit]);
    const blocked = await applyMigrations(interruptedDb);
    const audit = await auditMigrationState(interruptedDb);
    const pass = blocked.status === "blocked-partial" && audit.partial.includes(all[baselineLimit]);
    rec(scenarios, 18, "interrupted migration state is detected", pass ? "PASS" : "FAIL", JSON.stringify({ blocked, partial: audit.partial }));
  } catch (err) {
    rec(scenarios, 18, "interrupted migration state is detected", "FAIL", err instanceof Error ? err.message : String(err));
  }

  // ── Scenario 19: partial restore is detected ──
  try {
    const target = dbPath(run, "partial-restore");
    const res = restoreBackup(fullBackup, target);
    if (res.status !== "ok") throw new Error(`setup restore failed: ${JSON.stringify(res)}`);
    const manifest = readManifest(fullBackup);
    const preCheck = verifyRestoredIntegrity(target, manifest);
    // Simulate an interruption discovered after the fact: truncate the
    // restored file to half its size.
    truncateSync(target, Math.floor(manifest.byteSize / 2));
    const postCheck = verifyRestoredIntegrity(target, manifest);
    const pass = preCheck.ok === true && postCheck.ok === false;
    rec(scenarios, 19, "partial restore is detected", pass ? "PASS" : "FAIL", JSON.stringify({ preCheck, postCheck }));
  } catch (err) {
    rec(scenarios, 19, "partial restore is detected", "FAIL", err instanceof Error ? err.message : String(err));
  }

  // ── Scenario 20: missing migration is detected ──
  try {
    const missingDb = dbPath(run, "missing-mig");
    copyFileSync(freshDb, missingDb);
    const midIndex = Math.floor(total / 2);
    await simulate.deleteAppliedRecord(missingDb, all[midIndex]);
    const audit = await auditMigrationState(missingDb);
    const pass = audit.missing.includes(all[midIndex]);
    rec(scenarios, 20, "missing migration is detected", pass ? "PASS" : "FAIL", JSON.stringify({ missing: audit.missing }));
  } catch (err) {
    rec(scenarios, 20, "missing migration is detected", "FAIL", err instanceof Error ? err.message : String(err));
  }

  // ── Scenario 21: unknown future migration is detected ──
  try {
    const unknownDb = dbPath(run, "unknown-mig");
    copyFileSync(freshDb, unknownDb);
    const injected = await simulate.injectUnknownFuture(unknownDb);
    const audit = await auditMigrationState(unknownDb);
    const pass = audit.unknown.includes(injected);
    rec(scenarios, 21, "unknown future migration is detected", pass ? "PASS" : "FAIL", JSON.stringify({ unknown: audit.unknown }));
  } catch (err) {
    rec(scenarios, 21, "unknown future migration is detected", "FAIL", err instanceof Error ? err.message : String(err));
  }

  const report: CertificationReport = {
    scenarios,
    databaseType: "sqlite (local disposable file via @libsql/client 'file:' backend)",
    generatedAt: new Date().toISOString(),
  };
  return { report, run };
}

async function main(): Promise<void> {
  const { report: report1, run: run1 } = await runPipeline("run1");
  const { report: report2, run: run2 } = await runPipeline("run2");

  const norm1 = JSON.stringify(normalizeForComparison(report1));
  const norm2 = JSON.stringify(normalizeForComparison(report2));
  const deterministic = norm1 === norm2;

  const scenarios22: ScenarioResult[] = [...report1.scenarios];
  rec(
    scenarios22,
    22,
    "two complete runs produce deterministic normalized evidence",
    deterministic ? "PASS" : "FAIL",
    deterministic ? "run1 and run2 normalized evidence are identical" : "normalized evidence diverged between run1 and run2"
  );

  const combined: CertificationReport = {
    scenarios: scenarios22,
    databaseType: report1.databaseType,
    generatedAt: new Date().toISOString(),
  };

  const resultPath = resolve(REPO_ROOT, "docs", "r2", "certification-result.json");
  const summaryPath = resolve(REPO_ROOT, "docs", "r2", "certification-summary.md");
  writeResultArtifact(resultPath, combined);
  writeHumanSummary(summaryPath, combined);

  const { pass, fail, skip, overall } = summarize(combined);
  console.log(`[certify:r2-recovery] ${overall} — ${pass} PASS / ${fail} FAIL / ${skip} SKIP`);
  for (const s of combined.scenarios) {
    console.log(`  [${s.status}] ${s.id}. ${s.name}${s.detail ? " — " + s.detail : ""}`);
  }

  if (!KEEP) {
    cleanupCertRun(run1);
    cleanupCertRun(run2);
  } else {
    console.log(`[certify:r2-recovery] --keep set; run directories retained:\n  ${run1.root}\n  ${run2.root}`);
  }

  process.exit(overall === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error("[certify:r2-recovery] FATAL:", err);
  process.exit(1);
});
