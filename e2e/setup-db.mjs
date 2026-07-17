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

// ── R2-B1 Meeting Register fixture (Bid 2 / awarded PROJECT) ────────────────
// One READY meeting with a raw JSON transcript (segments materialize from it
// on first /segments read), two labeled participants, three PENDING register
// entries (extraction + bridge origins so coverage counts them), and the
// APPLIED extraction run they came from. Additive only — the navigation
// specs never open the meetings tab and are unaffected.
const RAW_TRANSCRIPT = JSON.stringify({
  segments: [
    { speaker: "SPEAKER_0", text: "We will pour the deck Friday morning.", start: 5.0, end: 9.0 },
    { speaker: "SPEAKER_1", text: "Steel delivery slipped two weeks.", start: 12.0, end: 16.0 },
    { speaker: "SPEAKER_1", text: "We will have the mockup panel on site by end of month.", start: 30.0, end: 35.0 },
  ],
});
const DISPLAY_TRANSCRIPT = [
  "[00:05] SPEAKER_0: We will pour the deck Friday morning.",
  "[00:12] SPEAKER_1: Steel delivery slipped two weeks.",
  "[00:30] SPEAKER_1: We will have the mockup panel on site by end of month.",
].join("\n");

await client.execute({
  sql: `INSERT INTO "Meeting" (
          id, bidId, title, meetingDate, meetingType, status,
          rawTranscript, transcript, summary, keyDecisions, openIssues,
          redFlags, analysisVersion, reviewStatus, analyzedAt, updatedAt
        ) VALUES (
          1, 2, 'OAC Meeting #12', '2026-07-10 14:00:00', 'OAC', 'READY',
          :rawTranscript, :transcript,
          'Deck pour scheduled, steel delivery slipped, terrazzo selected for the lobby.',
          '["Use terrazzo in lobby"]', '[]', '[]', 1, 'DRAFT',
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )`,
  args: { rawTranscript: RAW_TRANSCRIPT, transcript: DISPLAY_TRANSCRIPT },
});

await client.execute(
  `INSERT INTO "MeetingParticipant" (meetingId, name, role, speakerLabel, speakerType, isGcTeam)
   VALUES (1, 'Mike Torres', 'Superintendent', 'SPEAKER_0', 'IN_ROOM', true),
          (1, 'Sarah Chen', 'Owner Rep', 'SPEAKER_1', 'IN_ROOM', false)`
);

await client.execute(
  `INSERT INTO "MeetingExtractionRun"
     (id, meetingId, bidId, analysisVersion, trigger, status, previewJson, analysisJson, appliedBy, appliedAt)
   VALUES (1, 1, 2, 1, 'INITIAL', 'APPLIED', '{}', '{}', 'dev-admin', CURRENT_TIMESTAMP)`
);

// Three PENDING entries: a DECISION and a RISK from ai_extraction, plus a
// COMMITMENT from the commitment bridge — all count as "extracted" for the
// coverage / minutes-publish gate.
await client.execute(
  `INSERT INTO "MeetingRegisterEntry" (
     meetingId, bidId, entryType, rawSourceText, normalizedText, speakerLabel,
     responsibleParty, participantsJson, origin, extractionRunId, reviewState, updatedAt
   ) VALUES
   (1, 2, 'DECISION', 'Use terrazzo in lobby', 'Use terrazzo in lobby',
    'SPEAKER_0', NULL, '[]', 'ai_extraction', 1, 'PENDING', CURRENT_TIMESTAMP),
   (1, 2, 'COMMITMENT', 'We will have the mockup panel on site by end of month.',
    'Deliver mockup panel by end of month', 'SPEAKER_1', 'Sarah Chen', '[]',
    'commitment_bridge', 1, 'PENDING', CURRENT_TIMESTAMP),
   (1, 2, 'RISK', 'Steel delivery slipped two weeks.', 'Steel delivery slipped two weeks',
    'SPEAKER_1', NULL, '[]', 'ai_extraction', 1, 'PENDING', CURRENT_TIMESTAMP)`
);

console.log(`[e2e] fixture DB ready: ${E2E_DB_PATH} (${dirs.length} migrations)`);
client.close();
