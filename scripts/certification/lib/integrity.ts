// Local-only integrity checks for the R2 recovery certification harness:
// row counts, SQLite's own FK checker, and deterministic content digests
// used to prove specific rows survive an upgrade or a backup/restore
// round-trip byte-for-byte (modulo the DB-assigned autoincrement id, which
// is expected to be stable across a straight file-copy restore and is
// included in the digest for that reason).

import { openLocal, checkpointAndClose, sha256Json } from "./db";

export async function listTables(dbPath: string): Promise<string[]> {
  const client = openLocal(dbPath);
  const res = await client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_prisma_migrations' ORDER BY name"
  );
  await checkpointAndClose(client);
  return res.rows.map((r) => String(r.name));
}

export async function tableRowCounts(dbPath: string, tables: string[]): Promise<Record<string, number>> {
  const client = openLocal(dbPath);
  const out: Record<string, number> = {};
  for (const table of tables) {
    const res = await client.execute(`SELECT COUNT(*) as n FROM "${table}"`);
    out[table] = Number(res.rows[0]?.n ?? 0);
  }
  await checkpointAndClose(client);
  return out;
}

export interface ForeignKeyViolation {
  table: string;
  rowid: number | null;
  referredTable: string;
  fkidOrdinal: number;
}

export async function foreignKeyCheck(dbPath: string): Promise<ForeignKeyViolation[]> {
  const client = openLocal(dbPath);
  const res = await client.execute("PRAGMA foreign_key_check");
  const violations = res.rows.map((r) => ({
    table: String(r.table ?? r[0]),
    rowid: r.rowid == null ? null : Number(r.rowid ?? r[1]),
    referredTable: String(r.parent ?? r[2]),
    fkidOrdinal: Number(r.fkid ?? r[3] ?? 0),
  }));
  await checkpointAndClose(client);
  return violations;
}

export async function integrityCheckOk(dbPath: string): Promise<boolean> {
  const client = openLocal(dbPath);
  const res = await client.execute("PRAGMA integrity_check");
  await checkpointAndClose(client);
  const first = res.rows[0]?.integrity_check ?? res.rows[0]?.[0];
  return String(first).toLowerCase() === "ok";
}

// Deterministic sha256 over a table's rows, restricted to the given
// columns, ordered by "id" ascending. Used to prove specific content
// (provenance fields, attachment storage keys, audit rows, response-package
// chains, background job state) is byte-identical before and after a
// migration upgrade or a backup/restore round-trip.
export async function contentDigest(dbPath: string, table: string, columns: string[]): Promise<string> {
  const client = openLocal(dbPath);
  const colList = columns.map((c) => `"${c}"`).join(", ");
  const res = await client.execute(`SELECT ${colList} FROM "${table}" ORDER BY "id" ASC`);
  await checkpointAndClose(client);
  const rows = res.rows.map((r) => columns.map((c) => r[c]));
  return sha256Json(rows);
}

export async function scalarQuery<T = unknown>(dbPath: string, sql: string): Promise<T[]> {
  const client = openLocal(dbPath);
  const res = await client.execute(sql);
  await checkpointAndClose(client);
  return res.rows as unknown as T[];
}
