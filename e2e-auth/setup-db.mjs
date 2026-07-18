// Authenticated navigation fixture builder — LOCAL AND SYNTHETIC ONLY.
//
// Applies repository migrations to a new SQLite file under the OS temp
// directory, then seeds one synthetic admin account for the real credentials
// flow. It never connects to Turso, staging, or production.
import { createClient } from "@libsql/client";
import { readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import bcrypt from "bcryptjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_DB_PATH = join(tmpdir(), "gwx-e2e-auth-nav", "e2e.db");
export const E2E_USER_EMAIL = "e2e-operator@example.test";
export const E2E_USER_PASSWORD = "e2e-test-password-123";

const migrationDirectory = join(repoRoot, "prisma", "migrations");

rmSync(dirname(E2E_DB_PATH), { recursive: true, force: true });
mkdirSync(dirname(E2E_DB_PATH), { recursive: true });

const client = createClient({ url: `file:${E2E_DB_PATH}` });
const migrations = readdirSync(migrationDirectory)
  .filter((directory) => /^\d{8}/.test(directory))
  .sort();
for (const migration of migrations) {
  await client.executeMultiple(
    readFileSync(join(migrationDirectory, migration, "migration.sql"), "utf8"),
  );
}

await client.execute(
  `INSERT INTO "Bid" (id, projectName, status, workflowType, updatedAt)
   VALUES (1, 'E2E Auth Project', 'awarded', 'PROJECT', CURRENT_TIMESTAMP)`,
);

const passwordHash = bcrypt.hashSync(E2E_USER_PASSWORD, 10);
await client.execute({
  sql: `INSERT INTO "User" (id, name, email, hashedPassword, role, createdAt, updatedAt)
        VALUES (?, 'E2E Operator', ?, ?, 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: ["e2e-operator-user-1", E2E_USER_EMAIL, passwordHash],
});

console.log(`[e2e-auth] synthetic fixture ready (${migrations.length} migrations)`);
client.close();
