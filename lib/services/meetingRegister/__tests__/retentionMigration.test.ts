import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REMEDIATION = "20260718024444_r2_release_blocker_retention";
const DURABLE_TABLES = [
  "MeetingTranscriptSegment",
  "MeetingTranscriptCorrection",
  "MeetingExtractionRun",
  "MeetingRegisterEntry",
  "MeetingRegisterEntryRevision",
  "MeetingMinutesRevision",
] as const;

let root = "";
let url = "";
let sql: Client;
let orm: PrismaClient;
const beforeRows = new Map<string, string>();

async function rowsJson(table: string): Promise<string> {
  const result = await sql.execute(`SELECT * FROM "${table}" ORDER BY "id"`);
  return JSON.stringify(
    result.rows.map((row) =>
      Object.fromEntries(Object.entries(row).sort(([left], [right]) => left.localeCompare(right))),
    ),
  );
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "gwx-r2-retention-"));
  url = `file:${join(root, "retention.db")}`;
  sql = createClient({ url });

  const migrationRoot = join(process.cwd(), "prisma", "migrations");
  const migrations = readdirSync(migrationRoot)
    .filter((name) => /^\d{8}/.test(name))
    .sort();
  for (const name of migrations) {
    if (name === REMEDIATION) break;
    await sql.executeMultiple(readFileSync(join(migrationRoot, name, "migration.sql"), "utf8"));
  }

  await sql.executeMultiple(`
    INSERT INTO "Bid" ("id", "projectName", "status", "workflowType", "updatedAt")
      VALUES (91, 'Retention Fixture', 'awarded', 'PROJECT', CURRENT_TIMESTAMP);
    INSERT INTO "Meeting" ("id", "bidId", "title", "meetingDate", "status", "transcript", "updatedAt")
      VALUES (92, 91, 'Retention Meeting', CURRENT_TIMESTAMP, 'READY', '[00:01] SPEAKER_A: Preserve me.', CURRENT_TIMESTAMP);
    INSERT INTO "MeetingParticipant" ("id", "meetingId", "name", "speakerLabel", "isGcTeam")
      VALUES (93, 92, 'Source Speaker', 'SPEAKER_A', false),
             (94, 92, 'Target Speaker', 'SPEAKER_B', false);
    INSERT INTO "MeetingTranscriptSegment" (
      "id", "meetingId", "bidId", "segmentIndex", "sortKey",
      "originalSpeakerLabel", "originalText", "currentSpeakerLabel", "currentText", "updatedAt"
    ) VALUES (95, 92, 91, 0, 0, 'SPEAKER_A', 'Preserve me.', 'SPEAKER_A', 'Preserve me.', CURRENT_TIMESTAMP);
    INSERT INTO "MeetingTranscriptCorrection" (
      "id", "meetingId", "bidId", "correctionType", "segmentId", "correctedBy"
    ) VALUES (96, 92, 91, 'EDIT_TEXT', 95, 'fixture@example.test');
    INSERT INTO "MeetingExtractionRun" (
      "id", "meetingId", "bidId", "analysisVersion", "trigger", "status", "appliedBy", "appliedAt"
    ) VALUES (97, 92, 91, 1, 'INITIAL', 'APPLIED', 'fixture@example.test', CURRENT_TIMESTAMP);
    INSERT INTO "MeetingRegisterEntry" (
      "id", "meetingId", "bidId", "entryType", "rawSourceText", "normalizedText",
      "segmentId", "origin", "extractionRunId", "reviewState", "updatedAt"
    ) VALUES (98, 92, 91, 'DISCUSSION', 'Preserve me.', 'Preserve me.', 95, 'ai_extraction', 97, 'CONFIRMED', CURRENT_TIMESTAMP);
    INSERT INTO "MeetingRegisterEntryRevision" (
      "id", "entryId", "bidId", "changeType", "actor"
    ) VALUES (99, 98, 91, 'DISPOSITION', 'fixture@example.test');
    INSERT INTO "MeetingMinutesRevision" (
      "id", "meetingId", "bidId", "revisionIndex", "contentJson", "publishedBy"
    ) VALUES (100, 92, 91, 0, '{"fixture":true}', 'fixture@example.test');
  `);

  for (const table of DURABLE_TABLES) beforeRows.set(table, await rowsJson(table));

  await sql.executeMultiple(
    readFileSync(join(migrationRoot, REMEDIATION, "migration.sql"), "utf8"),
  );
  orm = new PrismaClient({ adapter: new PrismaLibSql({ url }) });
}, 30_000);

afterAll(async () => {
  await orm?.$disconnect();
  sql?.close();
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("R2 retention migration", () => {
  it("preserves every durable row value and initializes merge state safely", async () => {
    for (const table of DURABLE_TABLES) {
      expect(await rowsJson(table), table).toBe(beforeRows.get(table));
    }
    const participants = await sql.execute(
      `SELECT "id", "isActive", "mergedIntoParticipantId", "mergedAt", "mergedBy"
       FROM "MeetingParticipant" ORDER BY "id"`,
    );
    expect(participants.rows).toEqual([
      { id: 93, isActive: 1, mergedIntoParticipantId: null, mergedAt: null, mergedBy: null },
      { id: 94, isActive: 1, mergedIntoParticipantId: null, mergedAt: null, mergedBy: null },
    ]);
  });

  it("uses RESTRICT for both Meeting and Bid parents on every durable table", async () => {
    for (const table of [
      "MeetingTranscriptSegment",
      "MeetingTranscriptCorrection",
      "MeetingExtractionRun",
      "MeetingRegisterEntry",
      "MeetingMinutesRevision",
    ]) {
      const fks = await sql.execute(`PRAGMA foreign_key_list("${table}")`);
      const parents = fks.rows.filter((row) => row.table === "Meeting" || row.table === "Bid");
      expect(parents, table).toHaveLength(2);
      expect(parents.every((row) => row.on_delete === "RESTRICT"), table).toBe(true);
    }
    const revisionFks = await sql.execute('PRAGMA foreign_key_list("MeetingRegisterEntryRevision")');
    expect(
      revisionFks.rows
        .filter((row) => row.table === "MeetingRegisterEntry" || row.table === "Bid")
        .every((row) => row.on_delete === "RESTRICT"),
    ).toBe(true);
  });

  it("rejects direct ORM Meeting and Bid deletion without changing history", async () => {
    await expect(orm.meeting.delete({ where: { id: 92 } })).rejects.toMatchObject({ code: "P2003" });
    await expect(orm.bid.delete({ where: { id: 91 } })).rejects.toMatchObject({ code: "P2003" });
    for (const table of DURABLE_TABLES) {
      expect(await rowsJson(table), table).toBe(beforeRows.get(table));
    }
    expect(await orm.meeting.count({ where: { id: 92 } })).toBe(1);
    expect(await orm.bid.count({ where: { id: 91 } })).toBe(1);
  });

  it("retains all expected indexes and reports no foreign-key violations", async () => {
    const expectedIndexes: Record<string, string[]> = {
      MeetingTranscriptSegment: [
        "MeetingTranscriptSegment_meetingId_sortKey_idx",
        "MeetingTranscriptSegment_meetingId_currentSpeakerLabel_idx",
        "MeetingTranscriptSegment_bidId_idx",
      ],
      MeetingRegisterEntry: [
        "MeetingRegisterEntry_meetingId_entryType_idx",
        "MeetingRegisterEntry_meetingId_reviewState_idx",
        "MeetingRegisterEntry_bidId_reviewState_idx",
        "MeetingRegisterEntry_linkedTrackedItemId_idx",
      ],
      MeetingMinutesRevision: [
        "MeetingMinutesRevision_meetingId_revisionIndex_key",
        "MeetingMinutesRevision_supersedesRevisionId_key",
        "MeetingMinutesRevision_bidId_idx",
      ],
      MeetingParticipant: [
        "MeetingParticipant_meetingId_idx",
        "MeetingParticipant_meetingId_isActive_idx",
      ],
    };
    for (const [table, names] of Object.entries(expectedIndexes)) {
      const indexes = await sql.execute(`PRAGMA index_list("${table}")`);
      const actual = new Set(indexes.rows.map((row) => String(row.name)));
      for (const name of names) expect(actual.has(name), `${table}.${name}`).toBe(true);
    }
    expect((await sql.execute("PRAGMA foreign_key_check")).rows).toEqual([]);
  });
});
