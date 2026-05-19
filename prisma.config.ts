import { defineConfig } from "prisma/config";

// ──────────────────────────────────────────────────────────────────────────────
//  Prisma CLI datasource governance (Phase R6.5)
//
//  This file is consumed ONLY by the Prisma CLI (`prisma migrate`,
//  `prisma db push`, `prisma db seed`, `prisma studio`, `prisma generate`).
//
//  The application runtime — lib/prisma.ts — uses a SEPARATE code path
//  through @prisma/adapter-libsql that reads `process.env.DATABASE_URL` at
//  client construction time. That code path is unaffected by this file and
//  remains the authoritative production runtime DB connection.
//
//  Phase R6.5 changes the CLI datasource from a HARDCODED `file:./dev.db`
//  (which silently bypassed DATABASE_URL) to a tier-aware resolver:
//
//    1. If process.env.DATABASE_URL is set and starts with `file:`,
//       Prisma CLI uses it.
//    2. If process.env.DATABASE_URL is unset, falls back to `file:./dev.db`
//       so existing local-dev ergonomics ("just run `prisma migrate dev`")
//       continue to work without any env setup.
//    3. If process.env.DATABASE_URL is set to a `libsql://` or `https://`
//       URL, this file REFUSES to load and prints an operator-friendly
//       diagnostic.
//
//  Why refuse libsql:// in the CLI:
//
//  `prisma migrate deploy` (and most other Prisma CLI commands) against a
//  libsql:// URL returns Prisma error P1013 and silently mis-records
//  migration state in the `_prisma_migrations` table. Documented in
//  Migration/Production Runtime Assessment.txt §9 and §17 Medium, and
//  observed empirically 2026-05-15 (operator note carried from
//  feat/market-intelligence: migrate deploy silently applied to a throwaway
//  local file inside the migrate container and reported success).
//
//  The CORRECT way to apply migrations to staging or production Turso DBs
//  is the bespoke runner: `scripts/apply-turso-migrations.mjs` (Phase R6.6),
//  which uses @libsql/client directly and enforces an APP_ENV tier fence.
//  Invoke via `npm run migrate:turso` (or `npm run migrate:turso:status`
//  for dry-run). Full procedure in `runtime/runbooks/turso-migrations.md`.
//
//  Refusing in this file prevents the silent-failure mode entirely.
// ──────────────────────────────────────────────────────────────────────────────

const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";

if (!databaseUrl.startsWith("file:")) {
  const masked = databaseUrl.replace(/authToken=[^&]+/gi, "authToken=***");
  throw new Error(
    [
      "",
      "─────────────────────────────────────────────────────────────────────",
      "  prisma.config.ts: refusing non-file DATABASE_URL.",
      "─────────────────────────────────────────────────────────────────────",
      "",
      `  Got:  ${masked}`,
      "",
      "  Prisma CLI may only operate against local SQLite. Running it",
      "  against Turso/libSQL returns P1013 and silently mis-records",
      "  migration state in the _prisma_migrations table.",
      "",
      "  For local development:",
      '    • unset DATABASE_URL, OR',
      '    • set DATABASE_URL=file:./dev.db',
      "",
      "  For staging/production Turso migrations:",
      "    APP_ENV=<tier> DATABASE_URL=<tier-url> npm run migrate:turso",
      "    (full procedure: runtime/runbooks/turso-migrations.md)",
      "",
      "─────────────────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts",
  },
  datasource: {
    url: databaseUrl,
  },
});
