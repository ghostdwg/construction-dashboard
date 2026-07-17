// Authenticated e2e fixture DB builder — LOCAL ONLY.
//
// Same pattern as e2e/setup-db.mjs (fresh sqlite from the repo's own
// migration SQL, throwaway file under the OS temp dir), plus a seeded user
// with a real bcrypt password hash so e2e-auth/auth-navigation.spec.ts can
// sign in through the actual Auth.js credentials flow instead of the
// AUTH_DISABLED bypass.
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

const MIG_DIR = join(repoRoot, "prisma", "migrations");

rmSync(dirname(E2E_DB_PATH), { recursive: true, force: true });
mkdirSync(dirname(E2E_DB_PATH), { recursive: true });

const client = createClient({ url: `file:${E2E_DB_PATH}` });
const dirs = readdirSync(MIG_DIR).filter((d) => /^\d{8}/.test(d)).sort();
for (const d of dirs) {
  await client.executeMultiple(readFileSync(join(MIG_DIR, d, "migration.sql"), "utf8"));
}

await client.execute(
  `INSERT INTO "Bid" (id, projectName, status, workflowType, updatedAt)
   VALUES (1, 'E2E Auth Project', 'awarded', 'PROJECT', CURRENT_TIMESTAMP)`
);

const passwordHash = bcrypt.hashSync(E2E_USER_PASSWORD, 10);
await client.execute({
  sql: `INSERT INTO "User" (id, name, email, hashedPassword, role, createdAt, updatedAt)
        VALUES (?, 'E2E Operator', ?, ?, 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  args: ["e2e-operator-user-1", E2E_USER_EMAIL, passwordHash],
});

console.log(`[e2e-auth] fixture DB ready: ${E2E_DB_PATH} (${dirs.length} migrations, 1 user)`);
client.close();
