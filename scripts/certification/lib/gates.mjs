#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/lib/gates.mjs
//
//  One function per required validation gate. Every gate takes
//  `(worktreeDir, deps)` and returns `{ name, status: "pass"|"fail"|"skip", detail }`.
//  All subprocess env is built via buildAllowlistedEnv() (lib/env.mjs) — no
//  gate ever forwards ambient DATABASE_URL or provider credentials, and every
//  DB touched is a throwaway `file:` path under the worktree's own
//  `.certify-scratch/` directory. See docs/r2/CANDIDATE-VALIDATION-ORCHESTRATOR.md
//  for why `scripts/replay-validation.mjs` and `scripts/migration-lint.mjs`
//  (both already-existing, already-CI-required, non-staging local gates) are
//  reused here rather than reinvented.
// ──────────────────────────────────────────────────────────────────────────────

import { join } from "node:path";
import { buildAllowlistedEnv } from "./env.mjs";

function npxBin() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

/** Resolves a comparison base for "changed surface" gates: merge-base against
 *  origin/main if resolvable, else the candidate's own parent, else null
 *  (meaning: no determinable base — caller falls back to full-repo scope). */
export function resolveComparisonBase(worktreeDir, deps) {
  const fetchHead = deps.exec("git", ["-C", worktreeDir, "rev-parse", "--verify", "--quiet", "origin/main"]);
  if (fetchHead.status === 0) {
    const mergeBase = deps.exec("git", ["-C", worktreeDir, "merge-base", "HEAD", "origin/main"]);
    if (mergeBase.status === 0) return mergeBase.stdout.trim();
  }
  const parent = deps.exec("git", ["-C", worktreeDir, "rev-parse", "--verify", "--quiet", "HEAD^"]);
  if (parent.status === 0) return parent.stdout.trim();
  return null;
}

function changedFiles(worktreeDir, base, deps, pathspec = []) {
  if (!base) return null;
  const res = deps.exec("git", ["-C", worktreeDir, "diff", "--name-only", `${base}..HEAD`, "--", ...pathspec]);
  if (res.status !== 0) return null;
  return res.stdout.split("\n").map((l) => l.trim()).filter(Boolean);
}

export function gitDiffCheckGate(worktreeDir, deps) {
  const parent = deps.exec("git", ["-C", worktreeDir, "rev-parse", "--verify", "--quiet", "HEAD^"]);
  if (parent.status !== 0) {
    return { name: "GIT_DIFF_CHECK", status: "skip", detail: "candidate is a root commit — nothing to diff against" };
  }
  const res = deps.exec("git", ["-C", worktreeDir, "diff", "--check", `${parent.stdout.trim()}..HEAD`]);
  if (res.status !== 0) {
    return { name: "GIT_DIFF_CHECK", status: "fail", detail: res.stdout.trim() || res.stderr.trim() };
  }
  return { name: "GIT_DIFF_CHECK", status: "pass", detail: "no whitespace-conflict errors" };
}

export function typecheckGate(worktreeDir, deps) {
  const res = deps.exec(npxBin(), ["tsc", "--noEmit"], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, {}),
  });
  return {
    name: "TYPECHECK",
    status: res.status === 0 ? "pass" : "fail",
    detail: res.status === 0 ? "tsc --noEmit clean" : (res.stdout + res.stderr).trim(),
  };
}

export function eslintGate(worktreeDir, deps, base) {
  const files = changedFiles(worktreeDir, base, deps, ["*.ts", "*.tsx", "*.js", "*.jsx"]);
  const args = files && files.length > 0 ? files : ["."];
  const scope = files && files.length > 0 ? `${files.length} changed file(s)` : "full repo (no determinable base)";
  const res = deps.exec(npxBin(), ["eslint", ...args], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, {}),
  });
  return {
    name: "ESLINT",
    status: res.status === 0 ? "pass" : "fail",
    detail: `scope: ${scope}\n${(res.stdout + res.stderr).trim()}`.trim(),
  };
}

export function vitestGate(worktreeDir, deps) {
  const res = deps.exec(npxBin(), ["vitest", "run"], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, {}),
  });
  return {
    name: "FULL_VITEST",
    status: res.status === 0 ? "pass" : "fail",
    detail: (res.stdout + res.stderr).trim(),
  };
}

/** The overlaid __tests__/r2-regression suite runs as part of the same
 *  `vitest run` invocation above (vitest picks up all matching test files
 *  repo-wide) — this reports that fact rather than re-running vitest. */
export function regressionPackGate(worktreeDir, deps, vitestResult) {
  const exists = deps.fs.existsSync(join(worktreeDir, "__tests__", "r2-regression"));
  if (!exists) {
    return { name: "REGRESSION_PACK", status: "fail", detail: "__tests__/r2-regression was not overlaid into the candidate worktree" };
  }
  return {
    name: "REGRESSION_PACK",
    status: vitestResult.status,
    detail: "covered by the FULL_VITEST run above (same vitest invocation includes __tests__/r2-regression)",
  };
}

export function lifecycleCertificationGate(worktreeDir, deps) {
  const res = deps.exec("npm", ["run", "certify:r2-lifecycle"], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, {}),
  });
  return {
    name: "LIFECYCLE_CERTIFICATION",
    status: res.status === 0 ? "pass" : "fail",
    detail: (res.stdout + res.stderr).trim(),
  };
}

export function prismaValidateGate(worktreeDir, deps) {
  const placeholder = join(worktreeDir, ".certify-scratch", "validate-placeholder.db");
  const res = deps.exec(npxBin(), ["prisma", "validate"], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, { DATABASE_URL: `file:${placeholder}` }),
  });
  return {
    name: "PRISMA_VALIDATE",
    status: res.status === 0 ? "pass" : "fail",
    detail: (res.stdout + res.stderr).trim(),
  };
}

export function migrationLintGate(worktreeDir, deps) {
  const res = deps.exec("node", ["scripts/migration-lint.mjs", "--since=all"], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, {}),
  });
  // migration-lint.mjs exit code 3 = warnings only, does not block (see its own header).
  const status = res.status === 0 || res.status === 3 ? "pass" : "fail";
  return { name: "MIGRATION_LINT", status, detail: (res.stdout + res.stderr).trim() };
}

export function migrationReplayGate(worktreeDir, deps) {
  const scratchDb = join(worktreeDir, ".certify-scratch", "replay-validation.db");
  deps.fs.mkdirSync(join(worktreeDir, ".certify-scratch"), { recursive: true });
  const res = deps.exec("node", ["scripts/replay-validation.mjs"], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, { REPLAY_DB_PATH: scratchDb }),
  });
  return {
    name: "MIGRATION_REPLAY",
    status: res.status === 0 ? "pass" : "fail",
    detail: (res.stdout + res.stderr).trim(),
  };
}

export function pythonTestsGate(worktreeDir, deps, base) {
  const files = changedFiles(worktreeDir, base, deps, ["sidecar"]);
  const hasSidecarDir = deps.fs.existsSync(join(worktreeDir, "sidecar"));
  if (!hasSidecarDir) {
    return { name: "PYTHON_TESTS", status: "skip", detail: "no sidecar/ directory in this candidate" };
  }
  if (files !== null && files.length === 0) {
    return { name: "PYTHON_TESTS", status: "skip", detail: "candidate's changed surface does not touch sidecar/ — not applicable" };
  }
  const res = deps.exec("python3", ["-m", "pytest", "sidecar"], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, {}),
  });
  return {
    name: "PYTHON_TESTS",
    status: res.status === 0 ? "pass" : "fail",
    detail: (res.stdout + res.stderr).trim(),
  };
}

export function installDependencies(worktreeDir, deps, skipInstall) {
  if (skipInstall) {
    return { name: "INSTALL", status: "skip", detail: "--skip-install passed; assuming dependencies already valid" };
  }
  const res = deps.exec("npm", ["ci"], { cwd: worktreeDir, env: buildAllowlistedEnv(deps.ambientEnv, {}) });
  return {
    name: "INSTALL",
    status: res.status === 0 ? "pass" : "fail",
    detail: res.status === 0 ? "npm ci clean" : (res.stdout + res.stderr).trim(),
  };
}

export function prismaGenerateStep(worktreeDir, deps) {
  const placeholder = join(worktreeDir, ".certify-scratch", "generate-placeholder.db");
  const res = deps.exec(npxBin(), ["prisma", "generate"], {
    cwd: worktreeDir,
    env: buildAllowlistedEnv(deps.ambientEnv, { DATABASE_URL: `file:${placeholder}` }),
  });
  return {
    name: "PRISMA_GENERATE",
    status: res.status === 0 ? "pass" : "fail",
    detail: res.status === 0 ? "prisma client generated" : (res.stdout + res.stderr).trim(),
  };
}
