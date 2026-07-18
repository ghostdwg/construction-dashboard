#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/certify-r2-candidate.mjs
//
//  Disposable-worktree R2 candidate validation orchestrator. Certifies an
//  arbitrary GroundWorX R2 candidate commit against two independent
//  validation inputs (auth/regression pack + lifecycle certification
//  harness) in a throwaway detached git worktree, without ever modifying the
//  candidate's own branch/worktree or permanently merging either input.
//
//  Usage:
//    node scripts/certification/certify-r2-candidate.mjs <candidate-sha>
//        [--keep-worktree] [--output <dir>] [--skip-install]
//
//  See docs/r2/CANDIDATE-VALIDATION-ORCHESTRATOR.md for full documentation:
//  gates run, overlay mechanism, result interpretation, safety boundaries.
//
//  Exit codes: see lib/orchestrator.mjs header.
//
//  All logic lives in lib/*.mjs as pure, dependency-injected functions —
//  this file only parses argv, wires the real (non-test) dependencies, and
//  is the sole place this tool ever spawns a real subprocess or touches the
//  real filesystem. Importing lib/orchestrator.mjs (as every test does)
//  never reaches any of that.
// ──────────────────────────────────────────────────────────────────────────────

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { runCertification } from "./lib/orchestrator.mjs";

const HELP_TEXT = `
certify-r2-candidate — disposable-worktree R2 candidate validation orchestrator.

Usage:
  node scripts/certification/certify-r2-candidate.mjs <candidate-sha> [flags]

Flags:
  --keep-worktree     Do not remove the disposable worktree after the run
                      (investigation). Its path is printed in the summary.
  --output <dir>      Base directory for the disposable worktree and result
                      artifacts (default: a gwx-r2-certify dir under the OS
                      tmp directory).
  --skip-install      Skip "npm ci" — only safe when the candidate's
                      dependencies are already known-valid in this environment.
  --help, -h          Print this text and exit.

Exit codes:
  0 every gate passed (or was not applicable)
  1 invalid candidate or disposable-worktree setup failure
  2 overlay (validation-input merge) failed
  3 one or more required gates failed
  4 run was interrupted (SIGINT/SIGTERM)
  5 cleanup refused to remove an unowned/unmarked directory
`;

export function parseArgs(argv) {
  const args = { candidate: undefined, keepWorktree: false, outputDir: undefined, skipInstall: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep-worktree") { args.keepWorktree = true; continue; }
    if (a === "--output") { args.outputDir = argv[++i]; continue; }
    if (a === "--skip-install") { args.skipInstall = true; continue; }
    if (a === "--help" || a === "-h") { args.help = true; continue; }
    if (!a.startsWith("--") && args.candidate === undefined) { args.candidate = a; continue; }
  }
  return args;
}

function realExec(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    encoding: "utf8",
    shell: false,
  });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? String(res.error ?? "") };
}

function buildRealDeps() {
  return {
    exec: realExec,
    fs: {
      existsSync: fs.existsSync,
      mkdirSync: fs.mkdirSync,
      writeFileSync: fs.writeFileSync,
      readFileSync: fs.readFileSync,
      readdirSync: fs.readdirSync,
      statSync: fs.statSync,
    },
    now: () => new Date(),
    randomToken: () => randomBytes(16).toString("hex"),
    ambientEnv: process.env,
  };
}

export async function main(argv, deps = buildRealDeps()) {
  const args = parseArgs(argv);
  if (args.help || !args.candidate) {
    console.log(HELP_TEXT);
    return args.help ? 0 : 1;
  }

  const outputDir = args.outputDir ?? join(os.tmpdir(), "gwx-r2-certify");
  const opts = { outputDir, keepWorktree: args.keepWorktree, skipInstall: args.skipInstall, repoRoot: process.cwd() };

  const { exitCode, summary } = await runCertification(args.candidate, opts, deps);
  console.log(summary);
  return exitCode;
}

const invokedAsScript =
  typeof process !== "undefined" &&
  !!process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[certify-r2-candidate] FATAL", err);
      process.exit(1);
    });
}
