#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/lib/overlay.mjs
//
//  Cross-commit file overlay: brings specific paths from an independent
//  validation-input commit into the disposable candidate worktree via
//  `git checkout <sha> -- <path>...` — never a merge, never a whole-tree
//  checkout. package.json is a special case: it is JSON-merged (one script
//  key added) rather than overlaid wholesale, so the candidate's own
//  package.json (dependencies, other scripts) is never clobbered.
//
//  Also provides the before/after snapshot + verification used to prove the
//  candidate's own tracked content was not modified by anything other than
//  the overlay itself.
// ──────────────────────────────────────────────────────────────────────────────

import { join } from "node:path";

/** `git checkout <commitSha> -- <path>...` scoped to the disposable worktree. */
export function overlayCommitPaths(worktreeDir, commitSha, paths, deps) {
  if (paths.length === 0) return { ok: true };
  const res = deps.exec("git", ["-C", worktreeDir, "checkout", commitSha, "--", ...paths]);
  if (res.status !== 0) {
    return { ok: false, detail: `overlay from ${commitSha} failed for [${paths.join(", ")}]: ${res.stderr.trim()}` };
  }
  return { ok: true };
}

/** Adds/overwrites exactly one `scripts.<name>` entry in package.json — never a raw file overlay. */
export function mergePackageJsonScript(worktreeDir, scriptName, scriptValue, deps) {
  const pkgPath = join(worktreeDir, "package.json");
  let raw;
  try {
    raw = deps.fs.readFileSync(pkgPath, "utf8");
  } catch (err) {
    return { ok: false, detail: `cannot read ${pkgPath}: ${err.message}` };
  }
  let pkg;
  try {
    pkg = JSON.parse(raw);
  } catch (err) {
    return { ok: false, detail: `cannot parse ${pkgPath}: ${err.message}` };
  }
  pkg.scripts = pkg.scripts ?? {};
  pkg.scripts[scriptName] = scriptValue;
  deps.fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  return { ok: true };
}

/** Snapshot of candidate-identifying state, taken before any overlay is applied. */
export function snapshotCandidate(worktreeDir, deps) {
  const head = deps.exec("git", ["-C", worktreeDir, "rev-parse", "HEAD"]);
  const packageBlob = deps.exec("git", ["-C", worktreeDir, "rev-parse", "HEAD:package.json"]);
  return {
    headSha: head.stdout.trim(),
    packageJsonBlobSha: packageBlob.status === 0 ? packageBlob.stdout.trim() : null,
  };
}

/**
 * Proves the candidate's own tracked content is unchanged outside the
 * overlay paths and the one added package.json script key. Returns
 * { unchanged: true } or { unchanged: false, detail }.
 */
export function verifyCandidateUnchanged(worktreeDir, before, overlaidPaths, scriptName, deps) {
  const head = deps.exec("git", ["-C", worktreeDir, "rev-parse", "HEAD"]);
  const currentHead = head.stdout.trim();
  if (currentHead !== before.headSha) {
    return { unchanged: false, detail: `HEAD moved from ${before.headSha} to ${currentHead} — candidate ref was not supposed to change` };
  }

  const excludes = [...overlaidPaths, "package.json"].map((p) => `:!${p}`);
  const diff = deps.exec("git", ["-C", worktreeDir, "diff", "--stat", "HEAD", "--", ".", ...excludes]);
  if (diff.stdout.trim().length > 0) {
    return { unchanged: false, detail: `unexpected candidate diff outside overlay paths:\n${diff.stdout}` };
  }

  if (before.packageJsonBlobSha) {
    const beforeShow = deps.exec("git", ["-C", worktreeDir, "cat-file", "-p", before.packageJsonBlobSha]);
    let beforePkg, afterPkg;
    try {
      beforePkg = JSON.parse(beforeShow.stdout);
      afterPkg = JSON.parse(deps.fs.readFileSync(join(worktreeDir, "package.json"), "utf8"));
    } catch (err) {
      return { unchanged: false, detail: `could not parse package.json for before/after comparison: ${err.message}` };
    }
    const afterScriptsMinusAdded = { ...afterPkg.scripts };
    delete afterScriptsMinusAdded[scriptName];
    const beforeRest = { ...beforePkg, scripts: beforePkg.scripts };
    const afterRest = { ...afterPkg, scripts: afterScriptsMinusAdded };
    if (JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) {
      return { unchanged: false, detail: "package.json changed beyond the one added certification script key" };
    }
  }

  return { unchanged: true };
}
