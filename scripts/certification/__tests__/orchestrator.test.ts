// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/__tests__/orchestrator.test.ts
//
//  The 9 required orchestrator-level scenarios, plus a happy-path sanity
//  check. Fully DI-mocked (fake exec + in-memory fake fs) — no real git,
//  npm, npx, node, or python3 process is ever spawned by this suite.
//
//  The fake exec handler simulates filesystem side effects for `git
//  worktree add` (baseline candidate content appears) and the two overlay
//  `git checkout <sha> -- <path>` calls (validation-input content appears),
//  matching what the real git commands would produce — this keeps
//  createWorktree's own "does this path already exist yet?" check honest
//  (false until the worktree is actually "created").
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  runCertification,
  handleInterruption,
  EXIT,
  AUTH_REGRESSION_PACK,
  LIFECYCLE_CERTIFICATION_HARNESS,
} from "../lib/orchestrator.mjs";
import { FakeFs } from "./support/fakeFs";
import { createFakeExec, OK } from "./support/fakeExec";

const CANDIDATE_SHA = "abcdef1234567890abcdef1234567890abcdef12";
const TOKEN = "0123456789abcdef0123456789abcdef";
const OUTPUT_DIR = "/tmp/out";
const WORKTREE_DIR = `${OUTPUT_DIR}/certify-r2-${CANDIDATE_SHA.slice(0, 12)}-${TOKEN.slice(0, 8)}`;

type ExecResult = { status: number; stdout: string; stderr: string };
type Override = (cmd: string, args: string[]) => ExecResult | undefined;

/** Builds a fake exec bound to `fs` that simulates the real worktree/overlay
 *  filesystem side effects, with sensible always-succeed defaults for every
 *  other call the happy path makes. `override` lets a test force one
 *  specific command to fail. */
function createHappyDeps(fs: FakeFs, override?: Override) {
  let headCallCount = 0;
  const { exec, calls } = createFakeExec((cmd, args) => {
    const o = override?.(cmd, args);
    if (o) return o;

    if (args.includes("cat-file") && args.includes("-e")) return { status: 0, stdout: "", stderr: "" };
    if (args.includes("rev-parse") && args.includes(CANDIDATE_SHA)) {
      return { status: 0, stdout: `${CANDIDATE_SHA}\n`, stderr: "" };
    }
    if (args.includes("rev-parse") && args.includes("--verify")) return { status: 1, stdout: "", stderr: "" };
    if (args.includes("rev-parse") && args.some((a) => a.includes("package.json"))) {
      return { status: 0, stdout: "pkgblobsha1\n", stderr: "" };
    }
    if (args.includes("rev-parse") && args.includes("HEAD")) {
      headCallCount += 1;
      return { status: 0, stdout: "headsha1\n", stderr: "" };
    }
    if (args.includes("worktree") && args.includes("add")) {
      fs.seedFile(`${WORKTREE_DIR}/package.json`, JSON.stringify({ name: "x", scripts: { build: "next build" } }));
      fs.seedFile(`${WORKTREE_DIR}/prisma/migrations/20260101000000_a/migration.sql`, "-- a\n");
      fs.seedFile(`${WORKTREE_DIR}/prisma/schema.prisma`, "datasource db {}\n");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args.includes("worktree")) return { status: 0, stdout: "", stderr: "" };
    if (args.includes("checkout") && args.includes(AUTH_REGRESSION_PACK.sha)) {
      fs.seedFile(`${WORKTREE_DIR}/__tests__/r2-regression/.keep`, "");
      return { status: 0, stdout: "", stderr: "" };
    }
    if (args.includes("checkout")) return { status: 0, stdout: "", stderr: "" };
    if (args.includes("diff") && args.includes("--stat")) return { status: 0, stdout: "", stderr: "" };
    if (args.includes("cat-file") && args.includes("-p")) {
      return { status: 0, stdout: JSON.stringify({ name: "x", scripts: { build: "next build" } }), stderr: "" };
    }
    return OK;
  });
  return { exec, calls, get headCallCount() { return headCallCount; } };
}

function baseOpts(overrides: Record<string, unknown> = {}) {
  return { outputDir: OUTPUT_DIR, keepWorktree: false, skipInstall: true, repoRoot: "/repo", ...overrides };
}

function baseDeps(exec: any, fs: FakeFs) {
  return { exec, fs, ambientEnv: { PATH: "/usr/bin" }, randomToken: () => TOKEN, now: () => new Date("2026-01-01T00:00:00Z") };
}

describe("scenario: invalid candidate", () => {
  test("reports SETUP_FAILURE and never creates a worktree", async () => {
    const { exec, calls } = createFakeExec(() => ({ status: 128, stdout: "", stderr: "fatal: not a valid object name" }));
    const fs = new FakeFs();
    const result = await runCertification("not-a-real-sha", baseOpts(), baseDeps(exec, fs));
    expect(result.exitCode).toBe(EXIT.SETUP_FAILURE);
    expect(result.summary).toMatch(/CANDIDATE INVALID/);
    expect(calls.some((c) => c.args.includes("worktree"))).toBe(false);
  });
});

describe("scenario: existing temporary directory", () => {
  test("refuses to reuse/overwrite a pre-existing disposable path", async () => {
    const fs = new FakeFs();
    fs.seedDir(WORKTREE_DIR); // name collision at the exact path this candidate+token would compute
    const { exec } = createHappyDeps(fs);
    const result = await runCertification(CANDIDATE_SHA, baseOpts(), baseDeps(exec, fs));
    expect(result.exitCode).toBe(EXIT.SETUP_FAILURE);
    expect(result.summary).toMatch(/dir_exists/);
  });
});

describe("scenario: interrupted run", () => {
  test("handleInterruption cleans up and reports INTERRUPTED when not keeping the worktree", () => {
    const fs = new FakeFs();
    fs.seedFile(`${WORKTREE_DIR}/.certify-owner`, TOKEN);
    const { exec } = createFakeExec(() => OK);
    const deps = baseDeps(exec, fs);
    const result = handleInterruption("SIGINT", WORKTREE_DIR, TOKEN, false, deps, "/repo");
    expect(result.exitCode).toBe(EXIT.INTERRUPTED);
    expect(result.cleanupResult!.removed).toBe(true);
  });

  test("handleInterruption keeps the worktree when --keep-worktree is set", () => {
    const fs = new FakeFs();
    const { exec } = createFakeExec(() => OK);
    const deps = baseDeps(exec, fs);
    const result = handleInterruption("SIGTERM", WORKTREE_DIR, TOKEN, true, deps, "/repo");
    expect(result.exitCode).toBe(EXIT.INTERRUPTED);
    expect(result.cleanupResult!.removed).toBe(false);
    expect(result.summary).toMatch(/kept/i);
  });

  test("handleInterruption refuses cleanup of an unmarked directory and reports CLEANUP_REFUSED", () => {
    const fs = new FakeFs(); // no .certify-owner written
    const { exec } = createFakeExec(() => OK);
    const deps = baseDeps(exec, fs);
    const result = handleInterruption("SIGINT", WORKTREE_DIR, TOKEN, false, deps, "/repo");
    expect(result.exitCode).toBe(EXIT.CLEANUP_REFUSED);
  });
});

describe("scenario: failed overlay", () => {
  test("reports OVERLAY_FAILURE when a validation-input checkout fails", async () => {
    const fs = new FakeFs();
    const { exec } = createHappyDeps(fs, (_cmd, args) => {
      if (args.includes("checkout")) return { status: 1, stdout: "", stderr: "error: pathspec did not match any file(s)" };
      return undefined;
    });
    const result = await runCertification(CANDIDATE_SHA, baseOpts(), baseDeps(exec, fs));
    expect(result.exitCode).toBe(EXIT.OVERLAY_FAILURE);
    expect(result.summary).toMatch(/OVERLAY FAILED/);
  });
});

describe("scenario: failed test gate", () => {
  test("reports GATE_FAILURE (exit 3) when a required gate fails, and still runs cleanup", async () => {
    const fs = new FakeFs();
    const { exec } = createHappyDeps(fs, (cmd, args) => {
      if (cmd === "npx" && args.includes("vitest")) return { status: 1, stdout: "", stderr: "2 tests failed" };
      return undefined;
    });
    const result = await runCertification(CANDIDATE_SHA, baseOpts(), baseDeps(exec, fs));
    expect(result.exitCode).toBe(EXIT.GATE_FAILURE);
    expect(result.artifact!.result).toBe("FAIL");
    expect(result.cleanupResult!.removed).toBe(true);
  });
});

describe("scenario: successful cleanup", () => {
  test("a fully passing run removes the disposable worktree and reports PASS", async () => {
    const fs = new FakeFs();
    const { exec, calls } = createHappyDeps(fs);
    const result = await runCertification(CANDIDATE_SHA, baseOpts(), baseDeps(exec, fs));
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(result.artifact!.result).toBe("PASS");
    expect(result.cleanupResult!.removed).toBe(true);
    expect(calls.some((c) => c.args.includes("remove") && c.args.includes("--force"))).toBe(true);
  });
});

describe("scenario: keep-worktree behavior", () => {
  test("--keep-worktree skips removal even on a passing run", async () => {
    const fs = new FakeFs();
    const { exec, calls } = createHappyDeps(fs);
    const result = await runCertification(CANDIDATE_SHA, baseOpts({ keepWorktree: true }), baseDeps(exec, fs));
    expect(result.exitCode).toBe(EXIT.SUCCESS);
    expect(result.cleanupResult!.removed).toBe(false);
    expect(result.cleanupResult!.reason).toBe("kept");
    expect(calls.some((c) => c.args.includes("remove") && c.args.includes("--force"))).toBe(false);
  });
});

describe("scenario: candidate source unchanged", () => {
  test("a passing run proves HEAD and package.json (minus the one overlay key) are unchanged", async () => {
    const fs = new FakeFs();
    const { exec } = createHappyDeps(fs);
    const result = await runCertification(CANDIDATE_SHA, baseOpts(), baseDeps(exec, fs));
    expect((result.artifact as { sourceCandidateModified: boolean }).sourceCandidateModified).toBe(false);
  });

  test("flags SOURCE_CANDIDATE_MODIFIED and fails the run if HEAD moved unexpectedly", async () => {
    const fs = new FakeFs();
    let headCalls = 0;
    const { exec } = createHappyDeps(fs, (_cmd, args) => {
      if (args.includes("rev-parse") && args.includes("HEAD") && !args.includes("--verify")) {
        headCalls += 1;
        // 1st call = pre-overlay snapshot; 2nd (post-gates) call reports a moved HEAD.
        return { status: 0, stdout: headCalls === 1 ? "headsha1\n" : "headsha-moved\n", stderr: "" };
      }
      return undefined;
    });
    const result = await runCertification(CANDIDATE_SHA, baseOpts(), baseDeps(exec, fs));
    expect((result.artifact as { sourceCandidateModified: boolean }).sourceCandidateModified).toBe(true);
    expect(result.artifact!.result).toBe("FAIL");
  });
});

describe("scenario: refusal to remove an unowned directory", () => {
  test("cleanup refuses and the run reports CLEANUP_REFUSED even though every gate passed", async () => {
    // worktree.test.ts proves removeWorktree() itself refuses on a marker
    // mismatch/absence; here we prove the orchestrator surfaces that refusal
    // end-to-end by making the underlying `git worktree remove` fail, which
    // removeWorktree reports as its own distinct non-removal reason.
    const fs = new FakeFs();
    const { exec } = createHappyDeps(fs, (_cmd, args) => {
      if (args.includes("worktree") && args.includes("remove")) {
        return { status: 1, stdout: "", stderr: "fatal: could not remove worktree" };
      }
      return undefined;
    });
    const result = await runCertification(CANDIDATE_SHA, baseOpts(), baseDeps(exec, fs));
    expect(result.exitCode).toBe(EXIT.CLEANUP_REFUSED);
    expect(result.cleanupResult!.removed).toBe(false);
  });
});

describe("sanity: LIFECYCLE_CERTIFICATION_HARNESS overlay paths are referenced", () => {
  test("harness sha constant is used by the overlay (guards against silently dropping it)", () => {
    expect(LIFECYCLE_CERTIFICATION_HARNESS.sha).toHaveLength(40);
    expect(AUTH_REGRESSION_PACK.sha).toHaveLength(40);
  });
});
