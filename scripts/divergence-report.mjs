#!/usr/bin/env node
// Prod/staging divergence report — read-only, local Git metadata only.
//
// Compares an explicit production ref against an explicit staging ref and
// reports commit divergence, file-change divergence, Prisma migration
// directory delta, and BlobStore/storage overlap. Never fetches, pulls,
// pushes, merges, rebases, cherry-picks, or otherwise changes refs — every
// Git invocation below is a read-only plumbing/porcelain command
// (rev-parse, merge-base, log, diff --name-status).
//
// Usage:
//   node scripts/divergence-report.mjs --prod <ref> --staging <ref> [--out <path>]
//
// Both --prod and --staging must resolve to a local commit (branch, tag, or
// SHA already present in this repository's object database). Nothing is
// assumed or hard-coded; unresolvable refs fail with a clear error instead
// of silently falling back to a guess.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const HELP = `Prod/staging divergence report (read-only, local Git metadata only)

Usage:
  node scripts/divergence-report.mjs --prod <ref> --staging <ref> [--out <path>]
  node scripts/divergence-report.mjs --help

Required arguments:
  --prod <ref>      Git ref (branch, tag, or SHA) for the production line.
                     Must already resolve locally — nothing is fetched.
  --staging <ref>    Git ref (branch, tag, or SHA) for the staging line.
                     Must already resolve locally — nothing is fetched.

Optional arguments:
  --out <path>       Also write the exact same report to <path> on disk.
                      Stdout output is always produced regardless of --out.
  --help, -h          Print this help and exit without touching Git.

Behavior guarantees:
  - Read-only: only \`git rev-parse\`, \`git merge-base\`, \`git log\`, and
    \`git diff --name-status\` are invoked. No fetch, pull, push, merge,
    rebase, cherry-pick, checkout, reset, or branch mutation ever occurs.
  - No refs are hard-coded; both refs must be supplied explicitly and must
    already exist in the local repository.
  - Deterministic: output depends only on the two refs' current local
    commit graph, not on wall-clock time or environment.

Example:
  node scripts/divergence-report.mjs \\
    --prod feat/storage-auth-job-dedupe \\
    --staging feat/mi-10-operator-workspace
`;

function parseArgs(argv) {
  const args = { prod: null, staging: null, out: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (a === "--prod") {
      args.prod = argv[++i];
    } else if (a === "--staging") {
      args.staging = argv[++i];
    } else if (a === "--out") {
      args.out = argv[++i];
    } else {
      throw new UsageError(`Unrecognized argument: ${a}`);
    }
  }
  return args;
}

class UsageError extends Error {}

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function resolveRef(label, ref) {
  try {
    const full = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    if (!full) throw new Error("empty result");
    return full;
  } catch {
    throw new UsageError(
      `--${label} ref "${ref}" does not resolve to a local commit. ` +
        `This tool never fetches — verify the ref exists locally (e.g. \`git rev-parse ${ref}\`).`,
    );
  }
}

function shortSha(sha) {
  return git(["rev-parse", "--short", sha]);
}

function commitsExclusive(excludeRef, includeRef) {
  const out = git(["log", "--no-decorate", "--pretty=format:%H\t%h\t%ad\t%an\t%s", "--date=short", `${excludeRef}..${includeRef}`]);
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [hash, short, date, author, ...subjectParts] = line.split("\t");
    return { hash, short, date, author, subject: subjectParts.join("\t") };
  });
}

function changedFiles(baseRef, headRef) {
  const out = git(["diff", "--name-status", "--no-renames", `${baseRef}..${headRef}`]);
  if (!out) return [];
  return out.split("\n").map((line) => {
    const [status, ...pathParts] = line.split("\t");
    return { status, path: pathParts.join("\t") };
  });
}

function formatCommitList(commits) {
  if (commits.length === 0) return "  (none)";
  return commits.map((c) => `  ${c.short}  ${c.date}  ${c.author.padEnd(20)}  ${c.subject}`).join("\n");
}

function formatFileList(files) {
  if (files.length === 0) return "  (none)";
  return files.map((f) => `  ${f.status}\t${f.path}`).join("\n");
}

function migrationDirName(path) {
  const m = path.match(/^prisma\/migrations\/([^/]+)\//);
  return m ? m[1] : null;
}

function migrationDelta(prodFiles, stagingFiles) {
  const prodDirs = new Map();
  const stagingDirs = new Map();
  for (const f of prodFiles) {
    const dir = migrationDirName(f.path);
    if (dir) {
      if (!prodDirs.has(dir)) prodDirs.set(dir, []);
      prodDirs.get(dir).push(f);
    }
  }
  for (const f of stagingFiles) {
    const dir = migrationDirName(f.path);
    if (dir) {
      if (!stagingDirs.has(dir)) stagingDirs.set(dir, []);
      stagingDirs.get(dir).push(f);
    }
  }
  const prodOnly = [...prodDirs.keys()].filter((d) => !stagingDirs.has(d)).sort();
  const stagingOnly = [...stagingDirs.keys()].filter((d) => !prodDirs.has(d)).sort();
  const both = [...prodDirs.keys()].filter((d) => stagingDirs.has(d)).sort();
  return { prodDirs, stagingDirs, prodOnly, stagingOnly, both };
}

function isStorageRelated(path) {
  return /blob|storage/i.test(path);
}

function buildReport({ prodRef, stagingRef }) {
  const lines = [];
  const push = (s = "") => lines.push(s);

  const prodSha = resolveRef("prod", prodRef);
  const stagingSha = resolveRef("staging", stagingRef);
  const mergeBase = git(["merge-base", prodSha, stagingSha]);

  push("=".repeat(78));
  push("PROD / STAGING DIVERGENCE REPORT (read-only, local Git metadata only)");
  push("=".repeat(78));
  push();

  // 1. Exact refs compared and merge-base.
  push("1. REFS COMPARED");
  push("-".repeat(78));
  push(`  production ref : ${prodRef}`);
  push(`  production SHA : ${prodSha} (${shortSha(prodSha)})`);
  push(`  staging ref    : ${stagingRef}`);
  push(`  staging SHA    : ${stagingSha} (${shortSha(stagingSha)})`);
  push(`  merge-base     : ${mergeBase} (${shortSha(mergeBase)})`);
  if (mergeBase === prodSha) {
    push(`  relationship   : production is an ancestor of staging (staging is ahead)`);
  } else if (mergeBase === stagingSha) {
    push(`  relationship   : staging is an ancestor of production (production is ahead)`);
  } else {
    push(`  relationship   : lines have diverged from a common ancestor`);
  }
  push();

  // 2. Production-only commits.
  const prodOnlyCommits = commitsExclusive(stagingSha, prodSha);
  push("2. PRODUCTION-ONLY COMMITS (in production, not in staging)");
  push("-".repeat(78));
  push(`  count: ${prodOnlyCommits.length}`);
  push(formatCommitList(prodOnlyCommits));
  push();

  // 3. Staging-only commits.
  const stagingOnlyCommits = commitsExclusive(prodSha, stagingSha);
  push("3. STAGING-ONLY COMMITS (in staging, not in production)");
  push("-".repeat(78));
  push(`  count: ${stagingOnlyCommits.length}`);
  push(formatCommitList(stagingOnlyCommits));
  push();

  // 4. Files changed on each side (relative to merge-base).
  const prodFiles = changedFiles(mergeBase, prodSha);
  const stagingFiles = changedFiles(mergeBase, stagingSha);
  push("4. FILES CHANGED SINCE MERGE-BASE");
  push("-".repeat(78));
  push(`  production side: ${prodFiles.length} file(s)`);
  push(formatFileList(prodFiles));
  push();
  push(`  staging side: ${stagingFiles.length} file(s)`);
  push(formatFileList(stagingFiles));
  push();

  // 5. Overlapping changed files.
  const prodPaths = new Map(prodFiles.map((f) => [f.path, f.status]));
  const stagingPaths = new Map(stagingFiles.map((f) => [f.path, f.status]));
  const overlapPaths = [...prodPaths.keys()].filter((p) => stagingPaths.has(p)).sort();
  push("5. OVERLAPPING CHANGED FILES (touched on both sides since merge-base)");
  push("-".repeat(78));
  push(`  count: ${overlapPaths.length}`);
  if (overlapPaths.length === 0) {
    push("  (none)");
  } else {
    for (const p of overlapPaths) {
      push(`  prod:${prodPaths.get(p)}  staging:${stagingPaths.get(p)}\t${p}`);
    }
  }
  push();

  // 6. Prisma migration delta by migration-directory name.
  const mig = migrationDelta(prodFiles, stagingFiles);
  push("6. PRISMA MIGRATION DELTA (by migration-directory name)");
  push("-".repeat(78));
  push(`  production-only migration dirs: ${mig.prodOnly.length}`);
  mig.prodOnly.forEach((d) => push(`    ${d}`));
  if (mig.prodOnly.length === 0) push("    (none)");
  push();
  push(`  staging-only migration dirs: ${mig.stagingOnly.length}`);
  mig.stagingOnly.forEach((d) => push(`    ${d}`));
  if (mig.stagingOnly.length === 0) push("    (none)");
  push();
  push(`  migration dirs touched on BOTH sides (ordering must be verified): ${mig.both.length}`);
  mig.both.forEach((d) => push(`    ${d}`));
  if (mig.both.length === 0) push("    (none)");
  push();

  // 7. Explicit BlobStore/storage overlap analysis.
  const prodStorageFiles = prodFiles.filter((f) => isStorageRelated(f.path));
  const stagingStorageFiles = stagingFiles.filter((f) => isStorageRelated(f.path));
  const storageOverlap = overlapPaths.filter((p) => isStorageRelated(p));
  push("7. BLOBSTORE / STORAGE OVERLAP ANALYSIS");
  push("-".repeat(78));
  push(`  production-side storage-related files: ${prodStorageFiles.length}`);
  formatFileList(prodStorageFiles).split("\n").forEach((l) => push(`  ${l}`));
  push();
  push(`  staging-side storage-related files: ${stagingStorageFiles.length}`);
  formatFileList(stagingStorageFiles).split("\n").forEach((l) => push(`  ${l}`));
  push();
  push(`  storage-related files touched on BOTH sides: ${storageOverlap.length}`);
  if (storageOverlap.length === 0) {
    push("  (none) — no BlobStore/storage overlap detected between these two refs.");
  } else {
    storageOverlap.forEach((p) => push(`    ${p}`));
    push("  NOTE: these files diverged independently on both lines and warrant a manual");
    push("  diff review before any promotion decision is made.");
  }
  push();

  // 8. Reconciliation checklist — analysis only, not merge instructions.
  push("8. RECONCILIATION CHECKLIST");
  push("-".repeat(78));
  push("  This checklist is ANALYSIS GUIDANCE ONLY. It does not instruct any merge,");
  push("  rebase, cherry-pick, or ref change, and this tool performs none of those");
  push("  operations. Use it to scope a manual reconciliation review.");
  push();
  push(`  [ ] Review all ${overlapPaths.length} overlapping changed file(s) listed in section 5`);
  push("      for independent, potentially conflicting edits on each line.");
  push(`  [ ] Review the ${mig.both.length} migration directory name(s) touched on both`);
  push("      sides (section 6) for schema ordering or naming conflicts.");
  push(`  [ ] Review the ${storageOverlap.length} BlobStore/storage file(s) touched on both`);
  push("      sides (section 7) for storage-contract drift.");
  push(`  [ ] Confirm whether the ${prodOnlyCommits.length} production-only commit(s) in section 2`);
  push("      are already represented, superseded, or still pending on the staging line.");
  push(`  [ ] Confirm whether the ${stagingOnlyCommits.length} staging-only commit(s) in section 3`);
  push("      are intended for eventual promotion, and identify any that are not.");
  push("  [ ] Treat this report as a snapshot: re-run it if either ref moves before");
  push("      acting on its findings.");
  push();
  push("=".repeat(78));
  push("End of report.");
  push();

  return lines.join("\n");
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`${err.message}\n\n${HELP}`);
    process.exit(1);
  }

  if (args.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (!args.prod || !args.staging) {
    process.stderr.write(
      `Both --prod and --staging are required.\n\n${HELP}`,
    );
    process.exit(1);
  }

  let report;
  try {
    report = buildReport({ prodRef: args.prod, stagingRef: args.staging });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  process.stdout.write(report);

  if (args.out) {
    const outPath = resolve(process.cwd(), args.out);
    writeFileSync(outPath, report);
  }
}

main();
