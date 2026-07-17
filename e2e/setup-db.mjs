// E2E fixture DB builder — LOCAL ONLY.
//
// Builds a throwaway sqlite file from the repo's own prisma/migrations SQL
// (applied lexicographically, same order as the gated runner) and seeds the
// two bids the navigation specs depend on. This is a test fixture in the
// spirit of the in-memory adapter patterns: it never touches Turso, staging,
// or production, and the DB path lives under the OS temp directory.
import { createClient } from "@libsql/client";
import { readdirSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const E2E_DB_PATH = join(tmpdir(), "gwx-e2e-nav", "e2e.db");

const MIG_DIR = join(repoRoot, "prisma", "migrations");

rmSync(dirname(E2E_DB_PATH), { recursive: true, force: true });
mkdirSync(dirname(E2E_DB_PATH), { recursive: true });

const client = createClient({ url: `file:${E2E_DB_PATH}` });
const dirs = readdirSync(MIG_DIR).filter((d) => /^\d{8}/.test(d)).sort();
for (const d of dirs) {
  await client.executeMultiple(readFileSync(join(MIG_DIR, d, "migration.sql"), "utf8"));
}

// Two workflow shapes: a pre-award BID (pursuit nav visible) and an awarded
// PROJECT (pursuit hidden, coordination default) — the two per-bid nav modes.
await client.execute(
  `INSERT INTO "Bid" (id, projectName, status, workflowType, updatedAt)
   VALUES (1, 'E2E Pursuit Job', 'bidding', 'BID', CURRENT_TIMESTAMP)`
);
await client.execute(
  `INSERT INTO "Bid" (id, projectName, status, workflowType, updatedAt)
   VALUES (2, 'E2E Active Project', 'awarded', 'PROJECT', CURRENT_TIMESTAMP)`
);

console.log(`[e2e] fixture DB ready: ${E2E_DB_PATH} (${dirs.length} migrations)`);
client.close();
