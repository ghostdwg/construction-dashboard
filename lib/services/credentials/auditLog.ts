/**
 * Audit log for credential vault access.
 *
 * Every decrypt() call appends an NDJSON record. Path:
 *   /storage/audit/credentials-access.jsonl  (production)
 *
 * Fields per record:
 *   - timestamp
 *   - service
 *   - field
 *   - caller_module — must be passed explicitly by the decrypter
 *
 * Why NDJSON in a flat file: cheap, append-only, tail-friendly, survives
 * DB outages, easy to ship to external SIEM later. The audit log is itself
 * NEVER decrypted or shown to AI/prompt code — read by humans or by a future
 * monitor process.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";

const AUDIT_DIR  = "/storage/audit";
const AUDIT_FILE = path.join(AUDIT_DIR, "credentials-access.jsonl");

let _dirEnsured = false;

async function ensureDir(): Promise<void> {
  if (_dirEnsured) return;
  await fs.mkdir(AUDIT_DIR, { recursive: true });
  _dirEnsured = true;
}

export type AuditEvent = {
  timestamp: string;
  service: string;
  field: string;
  caller_module: string;
};

export async function auditCredentialRead(event: AuditEvent): Promise<void> {
  try {
    await ensureDir();
    const line = JSON.stringify(event) + "\n";
    await fs.appendFile(AUDIT_FILE, line, { encoding: "utf8" });
  } catch (err) {
    // Audit failure must not block the read, but it must be loud.
    // eslint-disable-next-line no-console
    console.error("[credential-audit] failed to write audit event", err, event);
  }
}

/**
 * Read the most recent N audit events. For admin debugging only.
 * Never include this output in any AI prompt.
 */
export async function readRecentAudits(limit = 50): Promise<AuditEvent[]> {
  try {
    const data = await fs.readFile(AUDIT_FILE, "utf8");
    const lines = data.trim().split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l) as AuditEvent; }
        catch { return null; }
      })
      .filter((x): x is AuditEvent => x !== null);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
