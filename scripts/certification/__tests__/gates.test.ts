// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/__tests__/gates.test.ts
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  resolveComparisonBase,
  gitDiffCheckGate,
  typecheckGate,
  eslintGate,
  vitestGate,
  regressionPackGate,
  lifecycleCertificationGate,
  prismaValidateGate,
  migrationLintGate,
  migrationReplayGate,
  pythonTestsGate,
  installDependencies,
  prismaGenerateStep,
} from "../lib/gates.mjs";
import { FakeFs } from "./support/fakeFs";
import { createFakeExec, OK } from "./support/fakeExec";

function deps(exec: any, fs = new FakeFs()) {
  return { exec, fs, ambientEnv: { PATH: "/usr/bin" } } as any;
}

describe("resolveComparisonBase", () => {
  test("uses merge-base against origin/main when resolvable", () => {
    const { exec } = createFakeExec((_cmd, args) => {
      if (args.includes("merge-base")) return { status: 0, stdout: "base-sha\n", stderr: "" };
      if (args.includes("origin/main")) return { status: 0, stdout: "origin-main-sha\n", stderr: "" };
      return OK;
    });
    expect(resolveComparisonBase("/wt", deps(exec))).toBe("base-sha");
  });

  test("falls back to HEAD^ when origin/main is unresolvable", () => {
    const { exec } = createFakeExec((_cmd, args) => {
      if (args.includes("origin/main")) return { status: 1, stdout: "", stderr: "" };
      if (args.includes("HEAD^")) return { status: 0, stdout: "parent-sha\n", stderr: "" };
      return OK;
    });
    expect(resolveComparisonBase("/wt", deps(exec))).toBe("parent-sha");
  });

  test("returns null when nothing is resolvable (root commit, no remote)", () => {
    const { exec } = createFakeExec(() => ({ status: 1, stdout: "", stderr: "" }));
    expect(resolveComparisonBase("/wt", deps(exec))).toBeNull();
  });
});

describe("gitDiffCheckGate", () => {
  test("skips on a root commit", () => {
    const { exec } = createFakeExec(() => ({ status: 1, stdout: "", stderr: "" }));
    const r = gitDiffCheckGate("/wt", deps(exec));
    expect(r.status).toBe("skip");
  });

  test("passes with no whitespace errors", () => {
    const { exec } = createFakeExec((_cmd, args) => {
      if (args.includes("HEAD^")) return { status: 0, stdout: "parent\n", stderr: "" };
      return OK;
    });
    const r = gitDiffCheckGate("/wt", deps(exec));
    expect(r.status).toBe("pass");
  });

  test("fails when git diff --check reports errors", () => {
    const { exec } = createFakeExec((_cmd, args) => {
      if (args.includes("HEAD^")) return { status: 0, stdout: "parent\n", stderr: "" };
      if (args.includes("--check")) return { status: 2, stdout: "file.ts:1: trailing whitespace.", stderr: "" };
      return OK;
    });
    const r = gitDiffCheckGate("/wt", deps(exec));
    expect(r.status).toBe("fail");
  });
});

describe("simple pass/fail gates", () => {
  test("typecheckGate reflects tsc exit code", () => {
    const { exec } = createFakeExec(() => ({ status: 0, stdout: "", stderr: "" }));
    expect(typecheckGate("/wt", deps(exec)).status).toBe("pass");
    const { exec: failExec } = createFakeExec(() => ({ status: 1, stdout: "error TS1234", stderr: "" }));
    expect(typecheckGate("/wt", deps(failExec)).status).toBe("fail");
  });

  test("vitestGate reflects vitest exit code", () => {
    const { exec } = createFakeExec(() => ({ status: 0, stdout: "", stderr: "" }));
    expect(vitestGate("/wt", deps(exec)).status).toBe("pass");
  });

  test("lifecycleCertificationGate reflects npm run exit code", () => {
    const { exec } = createFakeExec(() => ({ status: 1, stdout: "", stderr: "fail" }));
    expect(lifecycleCertificationGate("/wt", deps(exec)).status).toBe("fail");
  });

  test("prismaValidateGate uses a placeholder local DATABASE_URL", () => {
    const { exec, calls } = createFakeExec(() => OK);
    const r = prismaValidateGate("/wt", deps(exec));
    expect(r.status).toBe("pass");
    const env = calls[0].opts.env as Record<string, string>;
    expect(env.DATABASE_URL.startsWith("file:")).toBe(true);
  });

  test("migrationLintGate treats exit code 3 (warnings only) as passing", () => {
    const { exec } = createFakeExec(() => ({ status: 3, stdout: "warnings only", stderr: "" }));
    expect(migrationLintGate("/wt", deps(exec)).status).toBe("pass");
  });

  test("migrationLintGate fails on exit code 2 (destructive violation)", () => {
    const { exec } = createFakeExec(() => ({ status: 2, stdout: "destructive op found", stderr: "" }));
    expect(migrationLintGate("/wt", deps(exec)).status).toBe("fail");
  });

  test("migrationReplayGate points REPLAY_DB_PATH at a scratch path under the worktree", () => {
    const { exec, calls } = createFakeExec(() => OK);
    const r = migrationReplayGate("/wt", deps(exec));
    expect(r.status).toBe("pass");
    const env = calls[0].opts.env as Record<string, string>;
    expect(env.REPLAY_DB_PATH).toContain("/wt/.certify-scratch/");
  });

  test("installDependencies skips cleanly with --skip-install", () => {
    const { exec, calls } = createFakeExec(() => OK);
    const r = installDependencies("/wt", deps(exec), true);
    expect(r.status).toBe("skip");
    expect(calls).toHaveLength(0);
  });

  test("prismaGenerateStep passes on success", () => {
    const { exec } = createFakeExec(() => OK);
    expect(prismaGenerateStep("/wt", deps(exec)).status).toBe("pass");
  });
});

describe("regressionPackGate", () => {
  test("fails if the overlay never landed __tests__/r2-regression", () => {
    const fs = new FakeFs();
    const r = regressionPackGate("/wt", deps(createFakeExec(() => OK).exec, fs), { status: "pass" } as any);
    expect(r.status).toBe("fail");
  });

  test("mirrors the vitest result when the overlay is present", () => {
    const fs = new FakeFs();
    fs.seedDir("/wt/__tests__/r2-regression");
    const r = regressionPackGate("/wt", deps(createFakeExec(() => OK).exec, fs), { status: "pass" } as any);
    expect(r.status).toBe("pass");
  });
});

describe("eslintGate", () => {
  test("falls back to full-repo scope when no base is determinable", () => {
    const { exec, calls } = createFakeExec(() => OK);
    const r = eslintGate("/wt", deps(exec), null);
    expect(r.status).toBe("pass");
    expect(calls[0].args).toContain(".");
  });

  test("scopes to changed files when a base is determinable", () => {
    const { exec, calls } = createFakeExec((_cmd, args) => {
      if (args.includes("diff")) return { status: 0, stdout: "app/page.tsx\nlib/foo.ts\n", stderr: "" };
      return OK;
    });
    const r = eslintGate("/wt", deps(exec), "base-sha");
    expect(r.status).toBe("pass");
    expect(calls[calls.length - 1].args).toEqual(["eslint", "app/page.tsx", "lib/foo.ts"]);
  });
});

describe("pythonTestsGate", () => {
  test("skips when the candidate has no sidecar/ directory", () => {
    const r = pythonTestsGate("/wt", deps(createFakeExec(() => OK).exec, new FakeFs()), "base-sha");
    expect(r.status).toBe("skip");
  });

  test("skips when sidecar/ exists but the changed surface doesn't touch it", () => {
    const fs = new FakeFs();
    fs.seedDir("/wt/sidecar");
    const { exec } = createFakeExec((_cmd, args) => {
      if (args.includes("diff")) return { status: 0, stdout: "", stderr: "" };
      return OK;
    });
    const r = pythonTestsGate("/wt", deps(exec, fs), "base-sha");
    expect(r.status).toBe("skip");
  });

  test("runs pytest when sidecar/ is touched", () => {
    const fs = new FakeFs();
    fs.seedDir("/wt/sidecar");
    const { exec, calls } = createFakeExec((_cmd, args) => {
      if (args.includes("diff")) return { status: 0, stdout: "sidecar/services/ai_gateway.py\n", stderr: "" };
      return OK;
    });
    const r = pythonTestsGate("/wt", deps(exec, fs), "base-sha");
    expect(r.status).toBe("pass");
    expect(calls.some((c) => c.cmd === "python3")).toBe(true);
  });
});
