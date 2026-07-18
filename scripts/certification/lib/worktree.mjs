#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/lib/worktree.mjs
//
//  Disposable-worktree lifecycle: candidate validation, creation (with a
//  strong ownership marker), and marker-checked removal that refuses to
//  touch any directory it did not create. All git calls go through the
//  injected `deps.exec` (see lib/gates.mjs for the ExecFn shape) so tests
//  never spawn a real git process.
// ──────────────────────────────────────────────────────────────────────────────

import { join } from "node:path";

/** Confirms `sha` resolves to a real commit reachable from `cwd`'s object DB. */
export function validateCandidate(sha, deps, cwd) {
  if (typeof sha !== "string" || sha.trim().length === 0) {
    return { ok: false, detail: "candidate commit-ish must be a non-empty string" };
  }
  const catFile = deps.exec("git", ["-C", cwd, "cat-file", "-e", `${sha}^{commit}`]);
  if (catFile.status !== 0) {
    return { ok: false, detail: `candidate "${sha}" is not a valid commit reachable from this repository: ${catFile.stderr.trim()}` };
  }
  const rev = deps.exec("git", ["-C", cwd, "rev-parse", sha]);
  if (rev.status !== 0) {
    return { ok: false, detail: `could not resolve "${sha}" to a full commit sha: ${rev.stderr.trim()}` };
  }
  return { ok: true, sha: rev.stdout.trim() };
}

/**
 * Creates a disposable, detached worktree for `sha` under `baseOutputDir` and
 * writes a random-token ownership marker into it immediately. Refuses to
 * proceed if the target path already exists (surfaced as its own failure
 * mode rather than silently reused/overwritten).
 */
export function createWorktree(sha, baseOutputDir, deps, cwd) {
  const token = deps.randomToken();
  const dir = join(baseOutputDir, `certify-r2-${sha.slice(0, 12)}-${token.slice(0, 8)}`);

  if (deps.fs.existsSync(dir)) {
    return { ok: false, reason: "dir_exists", detail: `disposable worktree path already exists: ${dir}` };
  }

  deps.fs.mkdirSync(baseOutputDir, { recursive: true });

  const add = deps.exec("git", ["-C", cwd, "worktree", "add", "--detach", dir, sha]);
  if (add.status !== 0) {
    return { ok: false, reason: "git_worktree_failed", detail: add.stderr.trim() };
  }

  deps.fs.writeFileSync(join(dir, ".certify-owner"), token);
  return { ok: true, dir, token };
}

/**
 * Removes a disposable worktree ONLY if it carries the exact ownership token
 * this process created it with. Never force-deletes an unmarked or
 * mismarked directory.
 */
export function removeWorktree(dir, expectedToken, deps, cwd) {
  const markerPath = join(dir, ".certify-owner");

  if (!deps.fs.existsSync(markerPath)) {
    return { removed: false, reason: "missing_marker", detail: `refusing to remove ${dir}: no ownership marker present` };
  }

  let actual;
  try {
    actual = deps.fs.readFileSync(markerPath, "utf8").trim();
  } catch (err) {
    return { removed: false, reason: "missing_marker", detail: `refusing to remove ${dir}: could not read ownership marker (${err.message})` };
  }

  if (actual !== expectedToken) {
    return { removed: false, reason: "unowned", detail: `refusing to remove ${dir}: ownership marker mismatch` };
  }

  const rm = deps.exec("git", ["-C", cwd, "worktree", "remove", "--force", dir]);
  if (rm.status !== 0) {
    return { removed: false, reason: "git_remove_failed", detail: rm.stderr.trim() };
  }
  return { removed: true };
}
