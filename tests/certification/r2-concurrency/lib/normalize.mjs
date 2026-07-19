// Evidence normalization for the R2 real-SQLite concurrency certification.
//
// Two products:
//   scrub(text)      -> volatile tokens removed, for the human-readable log.
//   deterministicEvidence(results) -> the byte-stable blob whose sha256 is the
//                       determinism gate. It contains ONLY the per-case
//                       id|match|status matrix, which is engine-deterministic.
//                       Raw contention timing (case 4 may wait-and-commit OR hit
//                       SQLITE_BUSY — both valid) is deliberately excluded.
import { createHash } from "node:crypto";

export function scrub(text) {
  return String(text)
    // absolute /tmp working paths -> placeholder
    .replace(/\/tmp\/[A-Za-z0-9._\-\/]+/g, "<TMP>")
    // ISO-8601 timestamps
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<TS>")
    // "elapsedMs: 209" / "elapsed 12ms" / vitest "Duration 1.34s"
    .replace(/elapsedMs:\s*\d+/g, "elapsedMs: <MS>")
    .replace(/\b\d+(?:\.\d+)?\s?ms\b/g, "<MS>")
    .replace(/Duration\s+[\d.]+\s?m?s[^\n]*/g, "Duration <DUR>")
    .replace(/Start at\s+[\d:]+/g, "Start at <TIME>")
    // long hex ids / random suffixes
    .replace(/\b[0-9a-f]{16,}\b/gi, "<HEX>")
    // the case-4 engine-branch line (nondeterministic) collapses to a token
    .replace(/sqlite busy outcome \{[\s\S]*?\}/g, "sqlite busy outcome <CONTENTION_NORMALIZED>")
    .replace(/\r/g, "");
}

export function deterministicEvidence(results) {
  const lines = results
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((r) => `CASE ${String(r.id).padStart(2, "0")} | ${r.match} | ${r.status}`);
  return lines.join("\n") + "\n";
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}
