import { defineConfig } from "prisma/config";

// DATABASE_URL takes precedence so `prisma migrate deploy` hits the real prod DB
// (libsql://…turso.io) when run with --env-file. Falls back to local SQLite for
// dev. Lesson learned 2026-05-15: without this, migrate deploy silently applies
// to the throwaway local file inside the migrate container and reports success.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "ts-node --compiler-options {\"module\":\"CommonJS\"} prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  },
});
