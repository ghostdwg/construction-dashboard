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
import { createHash } from "node:crypto";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_DB_PATH = join(tmpdir(), "gwx-e2e-auth-nav", "e2e.db");
export const E2E_USER_EMAIL = "e2e-operator@example.test";
export const E2E_USER_PASSWORD = "e2e-test-password-123";
export const E2E_VALID_RESPONSE_TOKEN = "e2e-valid-response-token";
export const E2E_EXPIRED_RESPONSE_TOKEN = "e2e-expired-response-token";
export const E2E_REVOKED_RESPONSE_TOKEN = "e2e-revoked-response-token";

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

await client.execute(
  `INSERT INTO "TrackedItem" (
     id, bidId, kind, title, status, priority, sourceKind, extractionMethod,
     citationVerified, pmReviewRequired, gcInternalResponsibility, createdAt, updatedAt
   ) VALUES (
     9101, 1, 'FIELD_ITEM', 'Synthetic contractor response item', 'OPEN', 'MEDIUM',
     'manual', 'manual', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
   )`,
);
await client.execute(
  `INSERT INTO "ResponsePackage" (
     id, bidId, packageNumber, title, status, issuedAt, issuedBy, createdBy, createdAt, updatedAt
   ) VALUES (
     9201, 1, 1, 'Synthetic token-wall package', 'ISSUED', CURRENT_TIMESTAMP,
     'E2E Operator', 'E2E Operator', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
   )`,
);
await client.execute(
  `INSERT INTO "ResponsePackageItem" (id, packageId, bidId, trackedItemId, displayNumber)
   VALUES (9301, 9201, 1, 9101, 'FR-001')`,
);

const tokenHash = (token) => createHash("sha256").update(token, "utf8").digest("hex");
await client.batch([
  {
    sql: `INSERT INTO "ResponseAccessToken" (
            id, bidId, packageId, tokenHash, expiresAt, revokedAt, createdBy, createdAt
          ) VALUES (?, 1, 9201, ?, datetime('now', '+1 day'), NULL, 'E2E fixture', CURRENT_TIMESTAMP)`,
    args: ["e2e-valid-response-access", tokenHash(E2E_VALID_RESPONSE_TOKEN)],
  },
  {
    sql: `INSERT INTO "ResponseAccessToken" (
            id, bidId, packageId, tokenHash, expiresAt, revokedAt, createdBy, createdAt
          ) VALUES (?, 1, 9201, ?, datetime('now', '-1 day'), NULL, 'E2E fixture', CURRENT_TIMESTAMP)`,
    args: ["e2e-expired-response-access", tokenHash(E2E_EXPIRED_RESPONSE_TOKEN)],
  },
  {
    sql: `INSERT INTO "ResponseAccessToken" (
            id, bidId, packageId, tokenHash, expiresAt, revokedAt, createdBy, createdAt
          ) VALUES (?, 1, 9201, ?, datetime('now', '+1 day'), CURRENT_TIMESTAMP, 'E2E fixture', CURRENT_TIMESTAMP)`,
    args: ["e2e-revoked-response-access", tokenHash(E2E_REVOKED_RESPONSE_TOKEN)],
  },
]);

console.log(`[e2e-auth] synthetic fixture ready (${migrations.length} migrations)`);
client.close();
