// ──────────────────────────────────────────────────────────────────────────────
//  scripts/certification/__tests__/upgradeReplay.test.ts
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";
import { runIncrementalUpgradeValidation } from "../lib/upgradeReplay.mjs";
import { FakeFs } from "./support/fakeFs";
import { createFakeExec, OK } from "./support/fakeExec";

function seedMigrations(fs: FakeFs, names: string[]) {
  for (const name of names) {
    fs.seedFile(`/wt/prisma/migrations/${name}/migration.sql`, `-- ${name}\nCREATE TABLE "${name}" (id TEXT);\n`);
  }
  fs.seedFile("/wt/prisma/migrations/migration_lock.toml", 'provider = "sqlite"\n');
  fs.seedFile("/wt/prisma/schema.prisma", 'datasource db {\n  provider = "sqlite"\n}\n');
}

describe("runIncrementalUpgradeValidation", () => {
  test("skips when fewer than 2 migrations exist", async () => {
    const fs = new FakeFs();
    seedMigrations(fs, ["20260101000000_only_one"]);
    const { exec } = createFakeExec(() => OK);
    const deps = { fs, exec, ambientEnv: {}, listSqliteTables: async () => ["Foo"] } as any;
    const result = await runIncrementalUpgradeValidation("/wt", deps);
    expect(result.status).toBe("skip");
  });

  test("passes across all stages when every migrate deploy + table check succeeds", async () => {
    const fs = new FakeFs();
    seedMigrations(fs, [
      "20260101000000_a",
      "20260102000000_b",
      "20260103000000_c",
      "20260104000000_d",
    ]);
    const { exec, calls } = createFakeExec(() => OK);
    const deps = { fs, exec, ambientEnv: {}, listSqliteTables: async () => ["Foo"] } as any;
    const result = await runIncrementalUpgradeValidation("/wt", deps);
    expect(result.status).toBe("pass");
    // 3 stages (last-3), one `prisma migrate deploy` call each.
    const deployCalls = calls.filter((c) => c.args.includes("deploy"));
    expect(deployCalls).toHaveLength(3);
  });

  test("fails and stops at the stage where migrate deploy fails", async () => {
    const fs = new FakeFs();
    seedMigrations(fs, ["20260101000000_a", "20260102000000_b", "20260103000000_c"]);
    let call = 0;
    const { exec, calls } = createFakeExec((_cmd, args) => {
      if (args.includes("deploy")) {
        call += 1;
        if (call === 2) return { status: 1, stdout: "", stderr: "migration failed to apply" };
      }
      return OK;
    });
    const deps = { fs, exec, ambientEnv: {}, listSqliteTables: async () => ["Foo"] } as any;
    const result = await runIncrementalUpgradeValidation("/wt", deps);
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/stage 1/);
    // Should not attempt a third deploy after the second one failed.
    expect(calls.filter((c) => c.args.includes("deploy"))).toHaveLength(2);
  });

  test("fails when a stage applies cleanly but produces no tables", async () => {
    const fs = new FakeFs();
    seedMigrations(fs, ["20260101000000_a", "20260102000000_b"]);
    const { exec } = createFakeExec(() => OK);
    const deps = { fs, exec, ambientEnv: {}, listSqliteTables: async () => [] } as any;
    const result = await runIncrementalUpgradeValidation("/wt", deps);
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/no tables were created/);
  });
});
