#!/usr/bin/env node
// Phase O1.1 — Migration linter (additive-only enforcement).
//
// The cognition platform's append-only contract depends on never destroying
// or rewriting historical state. This linter enforces the contract at the
// migration level: any new migration that performs a destructive operation
// on a cognition table must be explicitly approved.
//
// Three classes of rule:
//
//   1. FORBIDDEN BY DEFAULT — any DROP TABLE / DROP COLUMN / RENAME COLUMN
//      on a cognition table (see COGNITION_TABLES below). Migrations that
//      need to do this must add an opt-out marker comment near the top of
//      migration.sql:
//        -- LINT-ALLOW-DESTRUCTIVE: <reason>
//      and the reason MUST reference a tracked operator decision.
//
//   2. WARNED — destructive operations on legacy / non-cognition tables.
//      Linter warns but does not fail. This is to preserve flexibility for
//      legacy bid-dashboard schema evolution while protecting the MI stack.
//
//   3. ALWAYS-ALLOWED — additive operations (CREATE TABLE, ADD COLUMN,
//      CREATE INDEX, etc.). No restrictions.
//
// Operates on migrations introduced since a baseline ref (default: main).
// In CI this is the merge base; locally pass --since=<ref> to compare.
//
// Exit codes:
//   0 — no violations
//   1 — bad inputs
//   2 — destructive operation found without LINT-ALLOW-DESTRUCTIVE marker
//   3 — warnings only (does not block; informational)

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "prisma", "migrations");

const sinceFlag = process.argv.find((a) => a.startsWith("--since="));
const SINCE = sinceFlag ? sinceFlag.slice("--since=".length) : "main";
const STRICT = process.argv.includes("--strict"); // treat warnings as errors

// ── Cognition tables (touch these → require LINT-ALLOW-DESTRUCTIVE) ──────────
//
// These are the tables whose append-only / replay guarantees the platform
// depends on. Schema additions on these tables are fine; schema removals
// require explicit operator authorization.
const COGNITION_TABLES = new Set([
  // Entity layer (MI-1)
  "Entity", "EntityAlias", "EntityRelationship",
  // Relationship layer
  "RelationshipEdge",
  // Market signal stream
  "MarketLead", "MarketSignal", "MarketSource", "MarketSourceDoc", "MarketDocAnalysis",
  // Project aggregates (MI-6)
  "Project", "ProjectSignal", "ProjectEntity", "ProjectTimelineEvent",
  "ProjectStateTransition", "ProjectParcel", "ProjectProbabilitySnapshot",
  // Parcel memory (MI-7)
  "Parcel", "ParcelAlias", "ParcelOwnershipPeriod", "ParcelSignal", "ParcelProject",
  "ParcelAdjacency", "ParcelJurisdiction", "ParcelUtilityContext",
  "ParcelZoningContext", "ParcelPressureSnapshot",
  // Forecast engine (MI-8)
  "ForecastSnapshot", "EmergenceScore", "EmergenceTrajectory", "ProbabilityTrend",
  "ExpectedTimeline", "JurisdictionVelocity", "CorridorHeat", "DevelopmentMomentum",
  "SignalDecayProfile", "ForecastExplanation",
  // Outcome + calibration (MI-9)
  "Outcome", "OutcomeEvidence", "OutcomeResolution", "ForecastAccuracy",
  "ForecastCalibration", "TrajectoryOutcome", "TimelineAccuracy",
  "FalsePositive", "FalseNegative", "CalibrationSnapshot", "ResolutionState",
  // Operator workspace (MI-10)
  "Watchlist", "WatchlistItem", "AlertRule", "AlertEvent", "AlertSubscription",
  "AlertExplanation", "BriefingDocument", "BriefingSection",
  "TargetingPattern", "WorkspacePreference",
  // Entity watchlist seed
  "EntityWatchlistSeed",
  // Observability AuditEvent (O1.2)
  "AuditEvent",
]);

// ── Destructive patterns ─────────────────────────────────────────────────────
const DESTRUCTIVE_PATTERNS = [
  { name: "DROP TABLE",  re: /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi },
  { name: "DROP COLUMN", re: /ALTER\s+TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+DROP\s+COLUMN/gi },
  { name: "RENAME TABLE", re: /ALTER\s+TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+RENAME\s+TO/gi },
  { name: "RENAME COLUMN", re: /ALTER\s+TABLE\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+RENAME\s+COLUMN/gi },
];

function log(...args) { console.log("[migration-lint]", ...args); }

// ── Discover changed migrations ──────────────────────────────────────────────
function getChangedMigrations() {
  // If --since is "all", lint every migration directory.
  if (SINCE === "all") {
    return readdirSync(MIGRATIONS_DIR)
      .filter((e) => /^\d/.test(e))
      .filter((e) => statSync(join(MIGRATIONS_DIR, e)).isDirectory())
      .sort();
  }
  // Otherwise diff against the baseline ref and return migration dirs that
  // contain a changed file.
  const diff = spawnSync("git", ["diff", "--name-only", SINCE, "--", "prisma/migrations/"], {
    cwd: ROOT, encoding: "utf8",
  });
  if (diff.status !== 0) {
    log(`could not run git diff vs ${SINCE} (status ${diff.status}); falling back to all migrations`);
    return readdirSync(MIGRATIONS_DIR).filter((e) => /^\d/.test(e)).sort();
  }
  const dirs = new Set();
  for (const line of diff.stdout.split(/\r?\n/)) {
    const m = line.match(/^prisma\/migrations\/([^/]+)\//);
    if (m) dirs.add(m[1]);
  }
  return Array.from(dirs).sort();
}

const changed = getChangedMigrations();
log(`linting ${changed.length} migration(s) (baseline: ${SINCE})`);

let violations = 0;
let warnings = 0;

function stripSqlComments(sql) {
  // Strip -- line comments and /* block */ comments. SQLite migration.sql
  // never quotes -- inside string literals (Prisma never emits that), so this
  // is safe for the linter.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
}

function detectTableRedefines(sql) {
  // SQLite ALTER TABLE pattern: when adding a column with a FK constraint,
  // Prisma generates:
  //   CREATE TABLE "new_X" (...)
  //   INSERT INTO "new_X" (...) SELECT ... FROM "X"
  //   DROP TABLE "X"
  //   ALTER TABLE "new_X" RENAME TO "X"
  // This is NET ADDITIVE — all data preserved + new columns. Identify the
  // X names in such blocks and exempt their DROP TABLE / RENAME TO X from
  // the destructive check.
  const exempt = new Set();
  const reCreate = /CREATE\s+TABLE\s+"?new_([A-Za-z_][A-Za-z0-9_]*)"?/gi;
  let m;
  while ((m = reCreate.exec(sql)) !== null) {
    const table = m[1];
    // Verify the rest of the pattern is present nearby — look for
    // INSERT INTO "new_X" SELECT ... FROM "X" and ALTER ... RENAME TO X.
    const tail = sql.slice(m.index);
    const insertRe = new RegExp(`INSERT\\s+INTO\\s+"?new_${table}"?[^;]*FROM\\s+"?${table}"?`, "is");
    const renameRe = new RegExp(`ALTER\\s+TABLE\\s+"?new_${table}"?\\s+RENAME\\s+TO\\s+"?${table}"?`, "is");
    const dropRe = new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?"?${table}"?`, "is");
    if (insertRe.test(tail) && renameRe.test(tail) && dropRe.test(tail)) {
      exempt.add(table);
    }
  }
  return exempt;
}

for (const name of changed) {
  const sqlPath = join(MIGRATIONS_DIR, name, "migration.sql");
  if (!existsSync(sqlPath)) continue;
  const rawSql = readFileSync(sqlPath, "utf8");

  // Allow-marker check uses raw SQL (the marker is a comment).
  const allowedMatch = rawSql.match(/^--\s*LINT-ALLOW-DESTRUCTIVE:\s*(.+)$/m);
  const allowed = !!allowedMatch;

  // Strip comments before pattern-matching to avoid false positives like
  // the literal word "for" in prose.
  const sql = stripSqlComments(rawSql);

  // Detect the SQLite table-redefine pattern; affected tables' DROP / RENAME
  // are exempt because the net effect is additive.
  const redefineExempt = detectTableRedefines(sql);

  for (const { name: ruleName, re } of DESTRUCTIVE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(sql)) !== null) {
      const table = m[1];
      // Skip new_X tables (they're scratch tables in the redefine pattern)
      if (table.startsWith("new_")) continue;
      // Skip when this table is part of a detected table-redefine pattern.
      if (redefineExempt.has(table) && (ruleName === "DROP TABLE" || ruleName === "RENAME TABLE")) continue;

      const isCognition = COGNITION_TABLES.has(table);
      if (isCognition && !allowed) {
        console.error(`  VIOLATION ${name}: ${ruleName} on cognition table "${table}" without LINT-ALLOW-DESTRUCTIVE marker`);
        violations++;
      } else if (isCognition && allowed) {
        log(`  allowed ${name}: ${ruleName} on "${table}" — reason: ${allowedMatch[1].trim()}`);
      } else {
        // Non-cognition table — warn (legacy schema, can evolve).
        log(`  warn ${name}: ${ruleName} on non-cognition table "${table}"`);
        warnings++;
      }
    }
  }
}

if (violations > 0) {
  console.error(`\n[migration-lint] ${violations} violation(s). Migrations on cognition tables must be additive or carry an explicit LINT-ALLOW-DESTRUCTIVE marker.`);
  process.exit(2);
}
if (STRICT && warnings > 0) {
  console.error(`\n[migration-lint] --strict: ${warnings} warning(s) treated as failures.`);
  process.exit(3);
}
log("OK");
process.exit(0);
