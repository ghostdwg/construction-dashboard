// Phase O1.5.d — Tests for canonical unique-constraint-violation detection.
//
// The detection helper is the load-bearing piece that makes duplicate
// RunnerLease.windowKey claims normalize to a no-op preemption across all
// three error shapes this codebase observes in practice (Prisma, libsql,
// raw SQLite-style message). These tests pin the contract so a future
// driver/adapter version bump cannot silently regress to ERROR audits.

import { describe, expect, test } from "vitest";
import { isUniqueConstraintError } from "../uniqueConstraintError";

describe("isUniqueConstraintError", () => {
  describe("Prisma normalized shape", () => {
    test("matches PrismaClientKnownRequestError code P2002", () => {
      const err = Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        clientVersion: "7.6.0",
        meta: { target: ["windowKey"] },
      });
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    test("does not match Prisma not-found code P2025", () => {
      const err = Object.assign(new Error("Record not found"), { code: "P2025" });
      expect(isUniqueConstraintError(err)).toBe(false);
    });

    test("does not match Prisma foreign-key code P2003", () => {
      const err = Object.assign(new Error("Foreign key constraint failed"), {
        code: "P2003",
      });
      expect(isUniqueConstraintError(err)).toBe(false);
    });
  });

  describe("libsql LibsqlError shape", () => {
    test("matches code SQLITE_CONSTRAINT_UNIQUE", () => {
      // Approximates @libsql/client LibsqlError shape.
      const err = Object.assign(
        new Error("SQLite error: UNIQUE constraint failed: RunnerLease.windowKey"),
        {
          code: "SQLITE_CONSTRAINT_UNIQUE",
          rawCode: 2067,
        }
      );
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    test("matches code SQLITE_CONSTRAINT_PRIMARYKEY", () => {
      const err = Object.assign(
        new Error("PRIMARY KEY constraint failed"),
        { code: "SQLITE_CONSTRAINT_PRIMARYKEY", rawCode: 1555 }
      );
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    test("matches rawCode 2067 even without code string", () => {
      const err = Object.assign(new Error("constraint failed"), { rawCode: 2067 });
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    test("matches rawCode 1555 even without code string", () => {
      const err = Object.assign(new Error("constraint failed"), { rawCode: 1555 });
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    test("matches extendedCode 2067 (some libsql versions)", () => {
      const err = Object.assign(new Error("constraint failed"), { extendedCode: 2067 });
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    test("does not match SQLITE_CONSTRAINT_FOREIGNKEY", () => {
      const err = Object.assign(new Error("FK failed"), {
        code: "SQLITE_CONSTRAINT_FOREIGNKEY",
        rawCode: 787,
      });
      expect(isUniqueConstraintError(err)).toBe(false);
    });

    test("does not match SQLITE_CONSTRAINT_NOTNULL", () => {
      const err = Object.assign(new Error("NOT NULL failed"), {
        code: "SQLITE_CONSTRAINT_NOTNULL",
        rawCode: 1299,
      });
      expect(isUniqueConstraintError(err)).toBe(false);
    });

    test("does not match SQLITE_CONSTRAINT_CHECK", () => {
      const err = Object.assign(new Error("CHECK failed"), {
        code: "SQLITE_CONSTRAINT_CHECK",
        rawCode: 275,
      });
      expect(isUniqueConstraintError(err)).toBe(false);
    });
  });

  describe("nested cause shape", () => {
    test("matches when LibsqlError-shaped cause carries the rawCode", () => {
      // Some Prisma wrap-through paths surface a generic Error with the
      // libsql driver error pinned as .cause.
      const driver = Object.assign(new Error("UNIQUE constraint failed: RunnerLease.windowKey"), {
        code: "SQLITE_CONSTRAINT_UNIQUE",
        rawCode: 2067,
      });
      const wrapper = Object.assign(new Error("query failed"), { cause: driver });
      expect(isUniqueConstraintError(wrapper)).toBe(true);
    });
  });

  describe("message-pattern fallback", () => {
    test("matches generic Error with SQLite UNIQUE message", () => {
      const err = new Error("UNIQUE constraint failed: RunnerLease.windowKey");
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    test("is case-insensitive", () => {
      const err = new Error("unique constraint failed: foo.bar");
      expect(isUniqueConstraintError(err)).toBe(true);
    });

    test("does not match generic non-constraint error", () => {
      const err = new Error("connection refused");
      expect(isUniqueConstraintError(err)).toBe(false);
    });

    test("does not match check constraint failed message", () => {
      const err = new Error("CHECK constraint failed: amount >= 0");
      expect(isUniqueConstraintError(err)).toBe(false);
    });
  });

  describe("non-error inputs", () => {
    test("null returns false", () => {
      expect(isUniqueConstraintError(null)).toBe(false);
    });
    test("undefined returns false", () => {
      expect(isUniqueConstraintError(undefined)).toBe(false);
    });
    test("string returns false", () => {
      expect(isUniqueConstraintError("UNIQUE constraint failed")).toBe(false);
    });
    test("number returns false", () => {
      expect(isUniqueConstraintError(2067)).toBe(false);
    });
  });
});
