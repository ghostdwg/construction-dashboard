#!/usr/bin/env node
/**
 * R2 real-SQLite concurrency certification runner.
 *
 * Reproduces the strongest real-SQLite concurrency evidence used to validate
 * the repaired SOL candidate — 11 cases, each exercising REAL file-backed
 * SQLite transaction behaviour with ACTUAL competing operations coordinated by
 * deterministic barriers (no sleeps as the race primitive).
 *
 * What it does, in order:
 *   1. Reconstruct the exact R2 final-convergence candidate under /tmp
 *      (assemble.sh), OR use GWX_R2_CANDIDATE_DIR if supplied.
 *   2. VERIFY the candidate fingerprint == 1514fd2a… (the pinned convergence
 *      target). Any mismatch is an EVIDENCE GAP and the run refuses (exit 3).
 *   3. Provision node_modules by hardlink-copy from the repaired worktree
 *      (never mutating it) and regenerate the Prisma client for the
 *      reconciled schema.
 *   4. Replay all migrations locally into a disposable template DB.
 *   5. Run each of the 11 cases in its OWN Vitest process against a FRESH copy
 *      of the migrated template (per-case isolation prevents a timed-out raw
 *      client from poisoning later connections — matches the prior evidence).
 *   6. Do this for N runs (default 2); the normalized per-case pass/fail matrix
 *      must be byte-identical across runs (determinism gate).
 *   7. Clean up every database and the whole /tmp working tree.
 *   8. Exit nonzero on any failed case, fingerprint mismatch, or nondeterminism.
 *
 * Never touches staging, production, Turso, the network, credentials, or real
 * project data. Only disposable `file:` SQLite databases under /tmp.
 *
 * Env: GWX_R2_SOL (repaired worktree, default the known path),
 *      GWX_R2_CANDIDATE_DIR (skip assembly, use this dir — still verified),
 *      GWX_R2_RUNS (default 2), GWX_R2_KEEP=1 (retain /tmp work),
 *      GWX_R2_EVIDENCE_OUT (write normalized evidence to this path).
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, copyFileSync, rmSync, existsSync, writeFileSync, readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deterministicEvidence, sha256, scrub } from "./lib/normalize.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const EXPECTED_FP = "1514fd2aecf99675d252089bce10b90af8a3b990742e4e5daf6d1f5e967e7760";
const SOL = process.env.GWX_R2_SOL ?? "/opt/neuroglitch/worktrees/gwx-sol-r2-ledger-integration";
const RUNS = Math.max(1, parseInt(process.env.GWX_R2_RUNS ?? "2", 10));
const KEEP = process.env.GWX_R2_KEEP === "1";
const EVIDENCE_OUT = process.env.GWX_R2_EVIDENCE_OUT ?? null;
const CERT_REL = "tests/certification/r2-concurrency/realSqliteConcurrency.cert.test.ts";

const CASES = JSON.parse(readFileSync(join(SCRIPT_DIR, "cases.json"), "utf8")).cases;

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", ...opts });
}
function log(...a) { console.log(...a); }
function fatal(msg) { console.error("CERT-FATAL:", msg); process.exit(2); }

function fingerprint(dir) {
  return sh("bash", ["-c",
    `git -C '${dir}' ls-files -s | LC_ALL=C sort | sha256sum | awk '{print $1}'`]).trim();
}

const WORK = mkdtempSync(join(tmpdir(), "gwx-r2-concurrency-cert-"));
let exitCode = 0;
try {
  // ── 1. candidate ─────────────────────────────────────────────────────────
  let CAND = process.env.GWX_R2_CANDIDATE_DIR;
  if (CAND) {
    log(`[candidate] provided GWX_R2_CANDIDATE_DIR=${CAND}`);
  } else {
    CAND = join(WORK, "candidate");
    log(`[candidate] reconstructing exact convergence candidate under ${CAND}`);
    sh("bash", [join(SCRIPT_DIR, "assemble.sh")], {
      env: { ...process.env, SRC: REPO_ROOT, SOL, CAND },
      stdio: ["ignore", "inherit", "inherit"],
    });
  }

  // ── 2. fingerprint gate ──────────────────────────────────────────────────
  const fp = fingerprint(CAND);
  log(`[fingerprint] tested   = ${fp}`);
  log(`[fingerprint] expected = ${EXPECTED_FP}`);
  if (fp !== EXPECTED_FP) {
    console.error(
      "EVIDENCE GAP: candidate fingerprint does not match the pinned R2 " +
      "convergence target. Refusing to certify a non-exact candidate.");
    process.exit(3);
  }
  log("[fingerprint] MATCH");

  // ── 3. provision node_modules (non-mutating to SOL) ──────────────────────
  const nm = join(CAND, "node_modules");
  if (!existsSync(nm)) {
    log(`[provision] hardlink-copy node_modules from ${SOL} (SOL is not mutated)`);
    sh("cp", ["-al", join(SOL, "node_modules"), nm]);
    // The generated Prisma client dirs must become INDEPENDENT copies (new
    // inodes) so `prisma generate` overwrites them without touching SOL's
    // hardlinked originals. Remove the candidate hardlinks, then deep-copy
    // (cp -a, no -l) the same dirs back as standalone files.
    for (const rel of [".prisma", join("@prisma", "client")]) {
      const dst = join(nm, rel);
      const src = join(SOL, "node_modules", rel);
      rmSync(dst, { recursive: true, force: true });
      if (existsSync(src)) sh("cp", ["-a", src, dst]);
    }
  }
  const prismaBin = join(nm, ".bin", "prisma");
  const vitestBin = join(nm, ".bin", "vitest");

  log("[provision] prisma generate (reconciled schema)");
  const gen = spawnSync(prismaBin, ["generate"], {
    cwd: CAND, encoding: "utf8",
    env: { ...process.env, DATABASE_URL: `file:${join(WORK, "generate.db")}` },
  });
  if (gen.status !== 0) { console.error(gen.stdout, gen.stderr); fatal("prisma generate failed"); }

  // ── 4. migrated template DB ──────────────────────────────────────────────
  const templateDb = join(WORK, "template.db");
  log("[migrate] prisma migrate deploy -> disposable template");
  const mig = spawnSync(prismaBin, ["migrate", "deploy"], {
    cwd: CAND, encoding: "utf8",
    env: { ...process.env, DATABASE_URL: `file:${templateDb}` },
  });
  const migTail = scrub(mig.stdout || "").trim().split("\n").slice(-3).join("\n");
  log(migTail);
  if (mig.status !== 0) { console.error(mig.stderr); fatal("prisma migrate deploy failed"); }
  if (!existsSync(templateDb)) fatal("template DB was not created by migrate deploy");

  // ── 5. overlay the committed cert test into the candidate ────────────────
  const certDst = join(CAND, CERT_REL);
  mkdirSync(dirname(certDst), { recursive: true });
  copyFileSync(join(SCRIPT_DIR, "realSqliteConcurrency.cert.ts"), certDst);

  // ── 6. runs ──────────────────────────────────────────────────────────────
  const passHashes = [];
  let firstResults = null;
  let allPass = true;
  for (let run = 1; run <= RUNS; run++) {
    log(`\n===== RUN ${run}/${RUNS} =====`);
    const results = [];
    for (const c of CASES) {
      const caseDir = join(WORK, `run${run}`, `case${c.id}`);
      const storage = join(caseDir, "storage");
      mkdirSync(storage, { recursive: true });
      const caseDb = join(caseDir, "concurrency.db");
      copyFileSync(templateDb, caseDb); // FRESH migrated DB per case
      const env = {
        ...process.env,
        DATABASE_URL: `file:${caseDb}`,
        STORAGE_LOCAL_PATH: storage,
        APP_ENV: "local",
        AUTH_DISABLED: "true",
        NO_COLOR: "1",
        CI: "true",
      };
      const r = spawnSync(vitestBin, ["run", CERT_REL, "-t", c.match], {
        cwd: CAND, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024,
      });
      const out = `${r.stdout || ""}${r.stderr || ""}`;
      const passed = r.status === 0 && /Tests\s+1 passed/.test(out) && !/\b\d+ failed/.test(out);
      results.push({ id: c.id, match: c.match, status: passed ? "PASS" : "FAIL" });
      log(`  CASE ${String(c.id).padStart(2, "0")}  ${passed ? "PASS" : "FAIL"}  ${c.match}`);
      if (!passed) {
        allPass = false;
        console.error(scrub(out).split("\n").slice(-25).join("\n"));
      }
    }
    const evidence = deterministicEvidence(results);
    const h = sha256(evidence);
    passHashes.push(h);
    if (run === 1) firstResults = results;
    log(`RUN ${run} normalized-evidence sha256 = ${h}`);
  }

  const deterministic = passHashes.every((h) => h === passHashes[0]);
  log(`\n[determinism] ${passHashes.join(" ")} => ${deterministic ? "DETERMINISTIC" : "NONDETERMINISTIC"}`);

  if (EVIDENCE_OUT) {
    const body = [
      "# R2 real-SQLite concurrency certification — normalized evidence",
      `expected_fingerprint=${EXPECTED_FP}`,
      `tested_fingerprint=${fp}`,
      `runs=${RUNS}`,
      ...passHashes.map((h, i) => `run${i + 1}_sha256=${h}`),
      `deterministic=${deterministic}`,
      "",
      deterministicEvidence(firstResults),
    ].join("\n");
    writeFileSync(EVIDENCE_OUT, body);
    log(`[evidence] ${EVIDENCE_OUT}`);
  }

  exitCode = allPass && deterministic ? 0 : 1;
  log(`\nCERT ${exitCode === 0 ? "PASS" : "FAIL"} (allPass=${allPass}, deterministic=${deterministic})`);
} finally {
  if (KEEP) log(`[cleanup] GWX_R2_KEEP=1 — retained ${WORK}`);
  else { rmSync(WORK, { recursive: true, force: true }); log(`[cleanup] removed ${WORK} (all databases deleted)`); }
}
process.exit(exitCode);
