// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/uniqueConstraintError.ts
//  Phase O1.5.d — Canonical unique-constraint-violation detection.
//
//  The RunnerLease atomic-claim mechanism relies on detecting a unique-key
//  collision on `RunnerLease.windowKey` and normalizing it to a no-op
//  preemption (claim returns ok=false reason="already_held"; the dispatcher
//  then returns ok=true preempted=true).
//
//  In a homogeneous Prisma-on-Postgres environment the only shape is
//  `PrismaClientKnownRequestError { code: "P2002" }`. But this project runs
//  Prisma over the @prisma/adapter-libsql against Turso (libsql://), and the
//  underlying @libsql/client raises `LibsqlError { code: "SQLITE_CONSTRAINT*",
//  rawCode: 2067|1555 }`. The adapter is *supposed* to map rawCode 2067/1555
//  to `kind: "UniqueConstraintViolation"` and Prisma then surfaces P2002 —
//  but on the activated staging stack at SHA 93a0c67 the LibsqlError escapes
//  un-translated for `prisma.runnerLease.create({...})`. The result was that
//  duplicate lease claims hit the `db_error` branch and the dispatcher
//  treated them as a hard failure (status=failed, exit code 2, ERROR audit).
//
//  This helper centralizes detection so the lease layer (and any future
//  caller — backfills, ingestion dedupe) handles all three shapes uniformly:
//    1. Prisma P2002 (the documented case)
//    2. libsql LibsqlError with code starting "SQLITE_CONSTRAINT" or rawCode
//       in {2067 SQLITE_CONSTRAINT_UNIQUE, 1555 SQLITE_CONSTRAINT_PRIMARYKEY}
//    3. Last-resort message-pattern fallback (UNIQUE constraint failed: ...).
//       This guards against future driver versions that change error shape
//       again — we'd rather over-normalize an idempotent retry than spam
//       ERROR audits.
// ──────────────────────────────────────────────────────────────────────────────

// libsql rawCode integer codes (from @libsql/core sqlite3 mapping).
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;

/**
 * Returns true if `err` is recognizably a unique-constraint violation from
 * any database layer this codebase touches (Prisma, @prisma/adapter-libsql,
 * raw @libsql/client). Does NOT misclassify foreign-key / not-null /
 * check-constraint violations.
 */
export function isUniqueConstraintError(err: unknown): boolean {
  if (err === null || err === undefined) return false;
  if (typeof err !== "object") return false;

  const e = err as {
    code?: unknown;
    rawCode?: unknown;
    extendedCode?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  // Shape 1: Prisma's normalized code.
  if (e.code === "P2002") return true;

  // Shape 2a: libsql code string. `code` here is the *extended* SQLite
  // string code (e.g. "SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY").
  // The non-unique "SQLITE_CONSTRAINT_FOREIGNKEY" / "_NOTNULL" / "_CHECK"
  // share the prefix — so we must check for the specific UNIQUE / PRIMARYKEY
  // suffixes rather than match the whole prefix.
  if (typeof e.code === "string") {
    if (
      e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      e.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    ) {
      return true;
    }
  }

  // Shape 2b: libsql rawCode integer (preferred — language-independent).
  if (typeof e.rawCode === "number") {
    if (
      e.rawCode === SQLITE_CONSTRAINT_UNIQUE ||
      e.rawCode === SQLITE_CONSTRAINT_PRIMARYKEY
    ) {
      return true;
    }
  }
  if (typeof e.extendedCode === "number") {
    if (
      e.extendedCode === SQLITE_CONSTRAINT_UNIQUE ||
      e.extendedCode === SQLITE_CONSTRAINT_PRIMARYKEY
    ) {
      return true;
    }
  }

  // Shape 3: nested cause (libsql wraps driver errors with `cause`).
  if (e.cause && typeof e.cause === "object") {
    if (isUniqueConstraintError(e.cause)) return true;
  }

  // Shape 4: last-resort message pattern. SQLite's standard text is
  // "UNIQUE constraint failed: <Table>.<column>" — used as the bottom-of-net
  // for future driver shape changes. Matched case-insensitively against the
  // start of the relevant substring so additional prefix text (Prisma
  // wrapping, libsql wrapping) does not defeat detection.
  if (typeof e.message === "string") {
    const msg = e.message.toLowerCase();
    if (msg.includes("unique constraint failed")) return true;
  }

  return false;
}
