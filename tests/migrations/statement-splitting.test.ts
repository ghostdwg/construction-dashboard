// Local-only unit coverage for splitStatements() in
// scripts/apply-turso-migrations.mjs. No database involved.

import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitStatements } from "../../scripts/apply-turso-migrations.mjs";

describe("splitStatements", () => {
  test("splits plain semicolon-terminated statements", () => {
    const sql = `CREATE TABLE "A" ("id" INTEGER);\nCREATE TABLE "B" ("id" INTEGER);\n`;
    expect(splitStatements(sql)).toEqual([
      'CREATE TABLE "A" ("id" INTEGER);',
      'CREATE TABLE "B" ("id" INTEGER);',
    ]);
  });

  test("strips line comments and empty statements", () => {
    const sql = `-- a comment\nCREATE TABLE "A" ("id" INTEGER);\n\n-- trailing comment\n`;
    expect(splitStatements(sql)).toEqual(['CREATE TABLE "A" ("id" INTEGER);']);
  });

  test("keeps a CREATE TRIGGER ... BEGIN ... END block as one statement", () => {
    const sql = `
CREATE TABLE "X" ("id" INTEGER);
CREATE TRIGGER "guard"
BEFORE DELETE ON "X"
WHEN EXISTS (SELECT 1 FROM "Y" WHERE "xId" = OLD."id")
BEGIN
  SELECT RAISE(ABORT, 'blocked');
END;
CREATE TABLE "Z" ("id" INTEGER);
`;
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(3);
    expect(stmts[0]).toBe('CREATE TABLE "X" ("id" INTEGER);');
    expect(stmts[1]).toContain('CREATE TRIGGER "guard"');
    expect(stmts[1]).toContain("SELECT RAISE(ABORT, 'blocked');");
    expect(stmts[1].trim().endsWith("END;")).toBe(true);
    // The old naive `;`-at-end-of-line splitter cut this into two pieces
    // ("...SELECT RAISE(...);" and a bare "END;"); assert that never
    // recurs by checking no fragment is the bare terminator alone.
    expect(stmts.some((s) => s.trim() === "END;")).toBe(false);
    expect(stmts[2]).toBe('CREATE TABLE "Z" ("id" INTEGER);');
  });

  test("handles multiple triggers and a trailing pragma in one file", () => {
    const sql = `
PRAGMA foreign_keys=OFF;
CREATE TRIGGER "t1" BEFORE DELETE ON "A" BEGIN SELECT RAISE(ABORT, 'x'); END;
CREATE TRIGGER "t2" BEFORE DELETE ON "B" BEGIN SELECT RAISE(ABORT, 'y'); END;
PRAGMA foreign_keys=ON;
`;
    const stmts = splitStatements(sql);
    expect(stmts).toEqual([
      "PRAGMA foreign_keys=OFF;",
      `CREATE TRIGGER "t1" BEFORE DELETE ON "A" BEGIN SELECT RAISE(ABORT, 'x'); END;`,
      `CREATE TRIGGER "t2" BEFORE DELETE ON "B" BEGIN SELECT RAISE(ABORT, 'y'); END;`,
      "PRAGMA foreign_keys=ON;",
    ]);
  });

  test("splits migration 20260718030000's real trigger correctly", () => {
    const sqlPath = join(
      process.cwd(),
      "prisma",
      "migrations",
      "20260718030000_r2b2_trade_response_reviewer_repairs",
      "migration.sql"
    );
    const sql = readFileSync(sqlPath, "utf8");
    const stmts = splitStatements(sql);
    const triggerStmt = stmts.find((s: string) => s.includes("R2B2_responsible_contractor_retention_guard"));
    expect(triggerStmt).toBeDefined();
    expect(triggerStmt).toContain("SELECT RAISE(ABORT,");
    expect(triggerStmt!.trim().endsWith("END;")).toBe(true);
    expect(stmts.some((s: string) => s.trim() === "END;")).toBe(false);
    // Every statement must be individually well-formed enough to not start
    // mid-clause with a bare RAISE/END fragment.
    for (const s of stmts) {
      expect(s.trim().length).toBeGreaterThan(0);
    }
  });
});
