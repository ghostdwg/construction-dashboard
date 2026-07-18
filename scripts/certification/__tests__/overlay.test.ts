// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/__tests__/overlay.test.ts
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import {
  overlayCommitPaths,
  mergePackageJsonScript,
  snapshotCandidate,
  verifyCandidateUnchanged,
} from "../lib/overlay.mjs";
import { FakeFs } from "./support/fakeFs";
import { createFakeExec, OK } from "./support/fakeExec";

describe("overlayCommitPaths", () => {
  test("no-ops on an empty path list", () => {
    const { exec, calls } = createFakeExec(() => OK);
    const result = overlayCommitPaths("/wt", "abc123", [], { exec } as any);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("checks out the given paths from the commit", () => {
    const { exec, calls } = createFakeExec(() => OK);
    const result = overlayCommitPaths("/wt", "abc123", ["__tests__/r2-regression"], { exec } as any);
    expect(result.ok).toBe(true);
    expect(calls[0].args).toEqual(["-C", "/wt", "checkout", "abc123", "--", "__tests__/r2-regression"]);
  });

  test("surfaces a checkout failure", () => {
    const { exec } = createFakeExec(() => ({ status: 1, stdout: "", stderr: "error: pathspec did not match" }));
    const result = overlayCommitPaths("/wt", "abc123", ["nope"], { exec } as any);
    expect(result.ok).toBe(false);
  });
});

describe("mergePackageJsonScript", () => {
  test("adds the script key without disturbing other keys", () => {
    const fs = new FakeFs();
    fs.seedFile("/wt/package.json", JSON.stringify({ name: "x", scripts: { build: "next build" } }));
    const result = mergePackageJsonScript("/wt", "certify:r2-lifecycle", "node scripts/certification/run-r2-certification.mjs", {
      fs,
    } as any);
    expect(result.ok).toBe(true);
    const written = JSON.parse(fs.readFileSync("/wt/package.json"));
    expect(written.scripts.build).toBe("next build");
    expect(written.scripts["certify:r2-lifecycle"]).toBe("node scripts/certification/run-r2-certification.mjs");
  });

  test("fails cleanly on unparseable package.json", () => {
    const fs = new FakeFs();
    fs.seedFile("/wt/package.json", "{ not json");
    const result = mergePackageJsonScript("/wt", "x", "y", { fs } as any);
    expect(result.ok).toBe(false);
  });
});

describe("snapshotCandidate / verifyCandidateUnchanged", () => {
  function fixedGit(head: string, pkgBlob: string) {
    return createFakeExec((_cmd, args) => {
      if (args.includes("rev-parse") && args.includes("HEAD")) return { status: 0, stdout: `${head}\n`, stderr: "" };
      if (args.includes("rev-parse") && args.some((a) => a.includes("package.json"))) {
        return { status: 0, stdout: `${pkgBlob}\n`, stderr: "" };
      }
      if (args.includes("diff")) return { status: 0, stdout: "", stderr: "" };
      if (args.includes("cat-file")) {
        return { status: 0, stdout: JSON.stringify({ name: "x", scripts: { build: "next build" } }), stderr: "" };
      }
      return OK;
    });
  }

  test("reports unchanged when HEAD is stable and diff is empty", () => {
    const fs = new FakeFs();
    fs.seedFile("/wt/package.json", JSON.stringify({ name: "x", scripts: { build: "next build", "certify:r2-lifecycle": "node x" } }));
    const { exec } = fixedGit("headsha1", "blobsha1");
    const deps = { exec, fs } as any;
    const before = snapshotCandidate("/wt", deps);
    const result = verifyCandidateUnchanged("/wt", before, ["__tests__/r2-regression"], "certify:r2-lifecycle", deps);
    expect(result.unchanged).toBe(true);
  });

  test("flags a HEAD move as changed", () => {
    const fs = new FakeFs();
    const { exec } = createFakeExec((_cmd, args) => {
      if (args.includes("rev-parse") && args.includes("HEAD")) return { status: 0, stdout: "moved-sha\n", stderr: "" };
      return OK;
    });
    const deps = { exec, fs } as any;
    const before = { headSha: "original-sha", packageJsonBlobSha: null };
    const result = verifyCandidateUnchanged("/wt", before, [], "certify:r2-lifecycle", deps);
    expect(result.unchanged).toBe(false);
  });

  test("flags a non-empty diff outside overlay paths as changed", () => {
    const fs = new FakeFs();
    const { exec } = createFakeExec((_cmd, args) => {
      if (args.includes("rev-parse") && args.includes("HEAD")) return { status: 0, stdout: "same-sha\n", stderr: "" };
      if (args.includes("diff")) return { status: 0, stdout: " app/page.tsx | 2 +-\n", stderr: "" };
      return OK;
    });
    const deps = { exec, fs } as any;
    const before = { headSha: "same-sha", packageJsonBlobSha: null };
    const result = verifyCandidateUnchanged("/wt", before, ["__tests__/r2-regression"], "certify:r2-lifecycle", deps);
    expect(result.unchanged).toBe(false);
  });

  test("flags package.json changes beyond the one added script key", () => {
    const fs = new FakeFs();
    fs.seedFile(
      "/wt/package.json",
      JSON.stringify({ name: "x", version: "9.9.9", scripts: { build: "next build", "certify:r2-lifecycle": "node x" } })
    );
    const { exec } = createFakeExec((_cmd, args) => {
      if (args.includes("rev-parse") && args.includes("HEAD")) return { status: 0, stdout: "same-sha\n", stderr: "" };
      if (args.includes("diff")) return { status: 0, stdout: "", stderr: "" };
      if (args.includes("cat-file")) {
        return { status: 0, stdout: JSON.stringify({ name: "x", version: "0.1.0", scripts: { build: "next build" } }), stderr: "" };
      }
      return OK;
    });
    const deps = { exec, fs } as any;
    const before = { headSha: "same-sha", packageJsonBlobSha: "blobsha1" };
    const result = verifyCandidateUnchanged("/wt", before, [], "certify:r2-lifecycle", deps);
    expect(result.unchanged).toBe(false);
  });
});
