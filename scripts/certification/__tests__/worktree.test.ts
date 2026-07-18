// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/__tests__/worktree.test.ts
//
//  Candidate validation, disposable-worktree creation, and marker-checked
//  removal — all DI-mocked, no real git process, no real filesystem.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import { validateCandidate, createWorktree, removeWorktree } from "../lib/worktree.mjs";
import { FakeFs } from "./support/fakeFs";
import { createFakeExec, OK } from "./support/fakeExec";

function baseDeps(overrides: Record<string, unknown> = {}) {
  const fs = new FakeFs();
  const { exec } = createFakeExec(() => OK);
  return { fs, exec, randomToken: () => "tok-fixed-0123456789abcdef", ...overrides };
}

describe("validateCandidate", () => {
  test("rejects an empty candidate string", () => {
    const deps = baseDeps();
    const result = validateCandidate("", deps, "/repo");
    expect(result.ok).toBe(false);
  });

  test("rejects a candidate git cannot resolve", () => {
    const { exec } = createFakeExec(() => ({ status: 128, stdout: "", stderr: "fatal: not a valid object name" }));
    const deps = baseDeps({ exec });
    const result = validateCandidate("not-a-real-sha", deps, "/repo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toMatch(/not a valid commit/);
  });

  test("accepts and normalizes a valid candidate sha", () => {
    const { exec } = createFakeExec((cmd, args) => {
      if (args.includes("rev-parse")) return { status: 0, stdout: "abcdef1234567890abcdef1234567890abcdef12\n", stderr: "" };
      return OK;
    });
    const deps = baseDeps({ exec });
    const result = validateCandidate("abcdef1", deps, "/repo");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.sha).toBe("abcdef1234567890abcdef1234567890abcdef12");
  });
});

describe("createWorktree", () => {
  test("refuses to proceed if the target path already exists", () => {
    const fs = new FakeFs();
    fs.seedDir("/tmp/out/certify-r2-abcdef123456-tok-fixe");
    const deps = baseDeps({ fs });
    const result = createWorktree("abcdef123456", "/tmp/out", deps, "/repo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("dir_exists");
  });

  test("creates the worktree and writes the ownership marker on success", () => {
    const fs = new FakeFs();
    const { exec, calls } = createFakeExec(() => OK);
    const deps = baseDeps({ fs, exec });
    const result = createWorktree("abcdef123456", "/tmp/out", deps, "/repo");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(fs.readFileSync(`${result.dir}/.certify-owner`)).toBe("tok-fixed-0123456789abcdef");
    }
    expect(calls.some((c) => c.args.includes("worktree") && c.args.includes("add"))).toBe(true);
  });

  test("surfaces a git worktree add failure distinctly", () => {
    const fs = new FakeFs();
    const { exec } = createFakeExec(() => ({ status: 1, stdout: "", stderr: "fatal: could not create work tree" }));
    const deps = baseDeps({ fs, exec });
    const result = createWorktree("abcdef123456", "/tmp/out", deps, "/repo");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("git_worktree_failed");
  });
});

describe("removeWorktree", () => {
  test("refuses to remove a directory with no ownership marker", () => {
    const fs = new FakeFs();
    fs.seedDir("/tmp/out/dir");
    const deps = baseDeps({ fs });
    const result = removeWorktree("/tmp/out/dir", "expected-token", deps, "/repo");
    expect(result.removed).toBe(false);
    if (!result.removed) expect(result.reason).toBe("missing_marker");
  });

  test("refuses to remove a directory whose marker token does not match", () => {
    const fs = new FakeFs();
    fs.seedFile("/tmp/out/dir/.certify-owner", "some-other-token");
    const deps = baseDeps({ fs });
    const result = removeWorktree("/tmp/out/dir", "expected-token", deps, "/repo");
    expect(result.removed).toBe(false);
    if (!result.removed) expect(result.reason).toBe("unowned");
  });

  test("removes a correctly-owned directory", () => {
    const fs = new FakeFs();
    fs.seedFile("/tmp/out/dir/.certify-owner", "expected-token");
    const { exec, calls } = createFakeExec(() => OK);
    const deps = baseDeps({ fs, exec });
    const result = removeWorktree("/tmp/out/dir", "expected-token", deps, "/repo");
    expect(result.removed).toBe(true);
    expect(calls.some((c) => c.args.includes("remove") && c.args.includes("--force"))).toBe(true);
  });

  test("surfaces a git worktree remove failure distinctly", () => {
    const fs = new FakeFs();
    fs.seedFile("/tmp/out/dir/.certify-owner", "expected-token");
    const { exec } = createFakeExec(() => ({ status: 1, stdout: "", stderr: "fatal: cannot remove" }));
    const deps = baseDeps({ fs, exec });
    const result = removeWorktree("/tmp/out/dir", "expected-token", deps, "/repo");
    expect(result.removed).toBe(false);
    if (!result.removed) expect(result.reason).toBe("git_remove_failed");
  });
});
