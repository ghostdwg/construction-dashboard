#!/usr/bin/env node
// scripts/validate-staging.mjs — Phase O1.4
//
// Operator-runnable, end-to-end staging validator. Checks every layer the
// platform's continuous-deployment workflow depends on:
//
//   1. App health endpoint reachable
//   2. Sidecar health endpoint reachable (if URL provided)
//   3. /metrics endpoint exposes Prometheus text-format
//   4. Turso migration state matches local migration set
//   5. Prometheus scrape target up (if PROMETHEUS_URL set)
//   6. Loki ingestion working (if LOKI_URL set + recent audit lines visible)
//   7. AuditEvent persistence working (test write + read)
//   8. RunnerLease coordination working (claim/heartbeat/release happy path)
//
// Each check produces a structured PASS/FAIL line + an overall summary.
// Exits 0 only when every required check passes. SKIPs are allowed when
// the corresponding URL/credential is not provided — make them PASSes by
// providing the env vars.
//
// Usage:
//   APP_URL=https://staging.groundworx.neuroglitch.ai \
//   SIDECAR_URL=http://sidecar.internal:8001 \
//   PROMETHEUS_URL=http://prometheus.internal:9090 \
//   LOKI_URL=http://loki.internal:3100 \
//   DATABASE_URL=libsql://groundworx-staging-...?authToken=... \
//   node scripts/validate-staging.mjs
//
// Or as a tier-gated wrapper:
//   APP_ENV=staging npm run validate:staging
//
// SAFETY: this script writes to AuditEvent + RunnerLease (test rows tagged
// with cycleName="validate-staging-NNN") but never deletes or mutates any
// cognition table. It uses libsql client directly to avoid Prisma CLI
// constraints against libsql:// URLs.

import { createClient } from "@libsql/client";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "prisma", "migrations");

const APP_URL = process.env.APP_URL || "";
const SIDECAR_URL = process.env.SIDECAR_URL || "";
const PROMETHEUS_URL = process.env.PROMETHEUS_URL || "";
const LOKI_URL = process.env.LOKI_URL || "";
const DATABASE_URL = process.env.DATABASE_URL || "";
const APP_ENV = process.env.APP_ENV || "";

const RUN_ID = `validate-${Date.now()}-${randomUUID().slice(0, 6)}`;
const results = [];

function record(name, ok, detail) {
  const symbol = ok === "PASS" ? "✔" : ok === "FAIL" ? "✗" : "•";
  results.push({ name, status: ok, detail });
  console.log(`  ${symbol} ${ok.padEnd(5)} ${name}${detail ? " — " + detail : ""}`);
}

async function checkAppHealth() {
  if (!APP_URL) return record("app health", "SKIP", "APP_URL not set");
  try {
    const r = await fetch(`${APP_URL}/api/health`, { headers: { "x-correlation-id": RUN_ID } });
    if (!r.ok) return record("app health", "FAIL", `status=${r.status}`);
    record("app health", "PASS", `status=${r.status}`);
  } catch (err) {
    record("app health", "FAIL", err.message);
  }
}

async function checkSidecarHealth() {
  if (!SIDECAR_URL) return record("sidecar health", "SKIP", "SIDECAR_URL not set");
  try {
    const r = await fetch(`${SIDECAR_URL}/health`);
    if (!r.ok) return record("sidecar health", "FAIL", `status=${r.status}`);
    record("sidecar health", "PASS", `status=${r.status}`);
  } catch (err) {
    record("sidecar health", "FAIL", err.message);
  }
}

async function checkMetricsEndpoint() {
  if (!APP_URL) return record("/metrics endpoint", "SKIP", "APP_URL not set");
  try {
    const r = await fetch(`${APP_URL}/metrics`);
    if (!r.ok) return record("/metrics endpoint", "FAIL", `status=${r.status}`);
    const body = await r.text();
    if (!body.includes("# TYPE")) {
      return record("/metrics endpoint", "FAIL", "no TYPE lines in response");
    }
    const counters = (body.match(/^# TYPE \S+ counter$/gm) || []).length;
    const histograms = (body.match(/^# TYPE \S+ histogram$/gm) || []).length;
    record("/metrics endpoint", "PASS", `${counters} counters, ${histograms} histograms`);
  } catch (err) {
    record("/metrics endpoint", "FAIL", err.message);
  }
}

async function checkPrometheusTarget() {
  if (!PROMETHEUS_URL) return record("Prometheus scrape target", "SKIP", "PROMETHEUS_URL not set");
  try {
    const r = await fetch(`${PROMETHEUS_URL}/api/v1/targets`);
    if (!r.ok) return record("Prometheus scrape target", "FAIL", `status=${r.status}`);
    const json = await r.json();
    const active = (json?.data?.activeTargets ?? []).filter(
      (t) => t.labels?.job?.startsWith("groundworx")
    );
    const up = active.filter((t) => t.health === "up");
    if (active.length === 0) {
      return record("Prometheus scrape target", "FAIL", "no groundworx_* targets found");
    }
    if (up.length < active.length) {
      return record("Prometheus scrape target", "FAIL", `${up.length}/${active.length} up`);
    }
    record("Prometheus scrape target", "PASS", `${up.length}/${active.length} up`);
  } catch (err) {
    record("Prometheus scrape target", "FAIL", err.message);
  }
}

async function checkLokiIngestion() {
  if (!LOKI_URL) return record("Loki ingestion", "SKIP", "LOKI_URL not set");
  try {
    const end = Date.now() * 1_000_000;        // ns
    const start = end - 600 * 1_000_000_000;    // last 10 min
    const query = encodeURIComponent('{container=~"groundworx_.*"}');
    const r = await fetch(
      `${LOKI_URL}/loki/api/v1/query_range?query=${query}&start=${start}&end=${end}&limit=5`
    );
    if (!r.ok) return record("Loki ingestion", "FAIL", `status=${r.status}`);
    const json = await r.json();
    const streams = json?.data?.result ?? [];
    const total = streams.reduce((s, x) => s + (x.values?.length ?? 0), 0);
    if (total === 0) return record("Loki ingestion", "FAIL", "no audit lines in last 10 min");
    record("Loki ingestion", "PASS", `${total} lines in last 10 min`);
  } catch (err) {
    record("Loki ingestion", "FAIL", err.message);
  }
}

function checkMigrationFolderConsistency() {
  let entries;
  try {
    entries = readdirSync(MIGRATIONS_DIR);
  } catch (err) {
    return record("migration folder readable", "FAIL", err.message);
  }
  // Canonical migration rule (Phase O1.5.a, aligned with
  // apply-turso-migrations.mjs and replay-validation.mjs):
  // directory starts with a digit AND contains migration.sql.
  // This filter must match Prisma CLI's behavior so all four tools
  // agree on the migration set count.
  const dirs = entries
    .filter((e) => /^\d/.test(e))
    .filter((e) => {
      try {
        if (!statSync(join(MIGRATIONS_DIR, e)).isDirectory()) return false;
        return statSync(join(MIGRATIONS_DIR, e, "migration.sql")).isFile();
      } catch {
        return false;
      }
    });
  if (dirs.length === 0) return record("migration folder readable", "FAIL", "no migration dirs");
  record("migration folder readable", "PASS", `${dirs.length} migrations on disk`);
  return dirs;
}

async function checkTursoMigrationParity(localMigrations) {
  if (!DATABASE_URL) return record("Turso migration parity", "SKIP", "DATABASE_URL not set");
  if (!DATABASE_URL.startsWith("libsql://") && !DATABASE_URL.startsWith("https://")) {
    return record("Turso migration parity", "SKIP", "DATABASE_URL not libsql/https");
  }
  let client;
  try {
    client = createClient({ url: DATABASE_URL });
    const result = await client.execute("SELECT migration_name, finished_at FROM _prisma_migrations");
    const applied = new Set(
      result.rows.filter((r) => r.finished_at).map((r) => r.migration_name)
    );
    const localSet = new Set(localMigrations);
    const missingOnRemote = [...localSet].filter((m) => !applied.has(m));
    const extraOnRemote = [...applied].filter((m) => !localSet.has(m));
    if (missingOnRemote.length > 0) {
      record("Turso migration parity", "FAIL",
        `${missingOnRemote.length} migrations not applied: ${missingOnRemote.slice(0, 3).join(", ")}${missingOnRemote.length > 3 ? " …" : ""}`);
    } else if (extraOnRemote.length > 0) {
      record("Turso migration parity", "FAIL",
        `${extraOnRemote.length} migrations on remote not in repo`);
    } else {
      record("Turso migration parity", "PASS",
        `${applied.size}/${localMigrations.length} applied`);
    }
  } catch (err) {
    record("Turso migration parity", "FAIL", err.message);
  } finally {
    if (client) await client.close();
  }
}

async function checkAuditEventWrite() {
  if (!DATABASE_URL) return record("AuditEvent write/read", "SKIP", "DATABASE_URL not set");
  let client;
  try {
    client = createClient({ url: DATABASE_URL });
    const id = `audittest_${RUN_ID}`;
    const now = new Date().toISOString();
    await client.execute({
      sql: `INSERT INTO AuditEvent
            (id, category, action, severity, actorKind, schemaVersion, decision, emittedAt)
            VALUES (?, 'system_health', 'staging_validation', 'INFO', 'system', '1.0', 'test', ?)`,
      args: [id, now],
    });
    const back = await client.execute({ sql: "SELECT id FROM AuditEvent WHERE id = ?", args: [id] });
    if (back.rows.length !== 1) {
      return record("AuditEvent write/read", "FAIL", "row not found after insert");
    }
    record("AuditEvent write/read", "PASS", `id=${id}`);
  } catch (err) {
    record("AuditEvent write/read", "FAIL", err.message);
  } finally {
    if (client) await client.close();
  }
}

async function checkRunnerLeaseCoordination() {
  if (!DATABASE_URL) return record("RunnerLease coordination", "SKIP", "DATABASE_URL not set");
  let client;
  try {
    client = createClient({ url: DATABASE_URL });
    const windowKey = `validate-staging_${RUN_ID}`;
    const leaseId = `lease_${RUN_ID}`;
    const token = randomUUID();
    const now = new Date().toISOString();
    const exp = new Date(Date.now() + 60_000).toISOString();
    await client.execute({
      sql: `INSERT INTO RunnerLease
            (id, cycleName, windowKey, status, leaseToken, leasedBy, leasedAt, leaseExpiresAt, lastHeartbeatAt, createdAt, updatedAt)
            VALUES (?, 'validate-staging', ?, 'claimed', ?, 'validator', ?, ?, ?, ?, ?)`,
      args: [leaseId, windowKey, token, now, exp, now, now, now],
    });
    // Attempt a second claim for the same windowKey — must fail.
    let duplicateRejected = false;
    try {
      await client.execute({
        sql: `INSERT INTO RunnerLease
              (id, cycleName, windowKey, status, leaseToken, leasedBy, leasedAt, leaseExpiresAt, lastHeartbeatAt, createdAt, updatedAt)
              VALUES (?, 'validate-staging', ?, 'claimed', ?, 'validator2', ?, ?, ?, ?, ?)`,
        args: [`${leaseId}_2`, windowKey, randomUUID(), now, exp, now, now, now],
      });
    } catch {
      duplicateRejected = true;
    }
    // Mark first lease succeeded.
    await client.execute({
      sql: `UPDATE RunnerLease SET status='succeeded', finishedAt=?, durationMs=10
            WHERE id=? AND leaseToken=?`,
      args: [new Date().toISOString(), leaseId, token],
    });
    if (!duplicateRejected) {
      record("RunnerLease coordination", "FAIL", "unique constraint on windowKey did not prevent dup");
    } else {
      record("RunnerLease coordination", "PASS", "claim/dup-reject/finalize ok");
    }
  } catch (err) {
    record("RunnerLease coordination", "FAIL", err.message);
  } finally {
    if (client) await client.close();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log("[validate-staging] starting");
console.log(`  RUN_ID=${RUN_ID}`);
console.log(`  APP_ENV=${APP_ENV || "(unset)"}`);
console.log(`  APP_URL=${APP_URL || "(unset)"}`);
console.log(`  DATABASE_URL=${DATABASE_URL ? "(set)" : "(unset)"}`);
console.log("");

await checkAppHealth();
await checkSidecarHealth();
await checkMetricsEndpoint();
const localMigrations = checkMigrationFolderConsistency() || [];
await checkTursoMigrationParity(localMigrations);
await checkPrometheusTarget();
await checkLokiIngestion();
await checkAuditEventWrite();
await checkRunnerLeaseCoordination();

console.log("");
const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
const skip = results.filter((r) => r.status === "SKIP").length;

console.log("═══════════════════════════════════════════════════════════");
console.log(`  STAGING VALIDATION — ${pass} pass · ${fail} fail · ${skip} skip`);
console.log("═══════════════════════════════════════════════════════════");

process.exit(fail > 0 ? 1 : 0);
