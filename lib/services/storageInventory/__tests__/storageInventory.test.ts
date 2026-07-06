// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/storageInventory/__tests__/storageInventory.test.ts
//
//  Full coverage for the storage inventory / journaled path backfill tool:
//    - classification matrix for all 6 model/field pairs (canonical /
//      legacy-cwd / legacy-storage-root-convertible / invalid, plus null)
//    - no-write proofs for default inventory mode and for --apply alone
//      (without the confirmation phrase)
//    - idempotent conversion (apply run twice)
//    - journal completeness (exactly one well-formed entry per converted row)
//    - idempotent reversal
//    - legacy-cwd / invalid rows never reach updateField, in any mode
//    - AddendumUpload/Meeting are reported (including their null bucket) but
//      NEVER passed to updateField, in any mode
//
//  NO REAL DATABASE OR NETWORK: every test uses FakeStorageInventoryDbAdapter
//  (see ./fixtures.ts), a plain in-memory object — no SQLite/libSQL file is
//  ever opened, no Prisma client is ever instantiated, no fetch/http call is
//  ever made. The only real filesystem I/O in this file is writing/reading
//  the JSON-lines JOURNAL file to a throwaway os.tmpdir() directory — that is
//  the journal feature itself (task requirement #3/#4), not "storage" in the
//  BlobStore/production sense; no BlobStore method is imported or called
//  anywhere in this file or in the tool's source (verified separately by
//  grep — see the task's final report).
// ──────────────────────────────────────────────────────────────────────────────

import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  buildFixtureData,
  CONVERTIBLE_ROW_IDS,
  FakeStorageInventoryDbAdapter,
  INVALID_ROW_IDS,
  LEGACY_CWD_ROW_IDS,
  SYNTHETIC_STORAGE_ROOT,
} from "./fixtures";
import { buildInventoryReport } from "@/lib/services/storageInventory/report";
import { runApply } from "@/lib/services/storageInventory/apply";
import { runReversal } from "@/lib/services/storageInventory/reversal";
import { readJournalEntries } from "@/lib/services/storageInventory/journal";
import { classifyInventoryRow } from "@/lib/services/storageInventory/classify";
import { CONFIRM_PHRASE, TOOL_VERSION } from "@/lib/services/storageInventory/types";

const TS = "2026-01-01T00:00:00.000Z";
const TS2 = "2026-01-02T00:00:00.000Z";

let previousStorageRoot: string | undefined;
let tmpDir: string;
let journalCounter = 0;

beforeAll(async () => {
  previousStorageRoot = process.env.STORAGE_LOCAL_PATH;
  process.env.STORAGE_LOCAL_PATH = SYNTHETIC_STORAGE_ROOT;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-inventory-test-"));
});

afterAll(async () => {
  if (previousStorageRoot === undefined) delete process.env.STORAGE_LOCAL_PATH;
  else process.env.STORAGE_LOCAL_PATH = previousStorageRoot;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function nextJournalPath(): string {
  journalCounter += 1;
  return path.join(tmpDir, `journal-${journalCounter}.jsonl`);
}

describe("classification matrix — every model/field pair, every shape", () => {
  test("SpecBook.filePath", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const report = await buildInventoryReport(adapter, TS);
    expect(report.models.SpecBook).toEqual({
      total: 4,
      canonical: 1,
      legacyCwd: 1,
      legacyStorageRoot: 1,
      legacyStorageRootConvertible: 1,
      invalid: 1,
      null: 0,
    });
  });

  test("SpecSection.pdfPath (including the genuinely-nullable not-yet-split case)", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const report = await buildInventoryReport(adapter, TS);
    expect(report.models.SpecSection).toEqual({
      total: 5,
      canonical: 1,
      legacyCwd: 1,
      legacyStorageRoot: 1,
      legacyStorageRootConvertible: 1,
      invalid: 1,
      null: 1,
    });
  });

  test("DrawingUpload.filePath", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const report = await buildInventoryReport(adapter, TS);
    expect(report.models.DrawingUpload).toEqual({
      total: 4,
      canonical: 1,
      legacyCwd: 1,
      legacyStorageRoot: 1,
      legacyStorageRootConvertible: 1,
      invalid: 1,
      null: 0,
    });
  });

  test("EstimateUpload.rawFilePath (two-segment bidId+subcontractorId scope)", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const report = await buildInventoryReport(adapter, TS);
    expect(report.models.EstimateUpload).toEqual({
      total: 4,
      canonical: 1,
      legacyCwd: 1,
      legacyStorageRoot: 1,
      legacyStorageRootConvertible: 1,
      invalid: 1,
      null: 0,
    });
  });

  test("AddendumUpload.storageKey — reported, legacy-storage-root NEVER convertible (inventory-only)", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const report = await buildInventoryReport(adapter, TS);
    expect(report.models.AddendumUpload).toEqual({
      total: 6,
      canonical: 1,
      legacyCwd: 1,
      legacyStorageRoot: 1,
      legacyStorageRootConvertible: 0,
      invalid: 1,
      null: 2,
    });
  });

  test("Meeting.audioStorageKey — scoped by its own id, reported, never convertible (inventory-only)", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const report = await buildInventoryReport(adapter, TS);
    expect(report.models.Meeting).toEqual({
      total: 6,
      canonical: 1,
      legacyCwd: 1,
      legacyStorageRoot: 1,
      legacyStorageRootConvertible: 0,
      invalid: 1,
      null: 2,
    });
  });

  test("aggregate report never carries raw path values — only counts/labels", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const report = await buildInventoryReport(adapter, TS);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(SYNTHETIC_STORAGE_ROOT);
    expect(serialized).not.toContain(".pdf");
    expect(serialized).not.toContain(".mp3");
  });
});

describe("no-write proofs", () => {
  test("default inventory mode never calls updateField, even with convertible rows present", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    await buildInventoryReport(adapter, TS);
    expect(adapter.calls).toHaveLength(0);
  });

  test("--apply alone (no confirmation phrase) performs zero writes and never touches the journal", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();
    const result = await runApply(adapter, { apply: true, confirmPhrase: undefined, journalPath, now: TS });

    expect(result.gated).toBe(false);
    expect(result.applied).toHaveLength(0);
    expect(adapter.calls).toHaveLength(0);
    await expect(fs.access(journalPath)).rejects.toThrow();
  });

  test("--apply with a WRONG confirmation phrase also performs zero writes", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();
    const result = await runApply(adapter, {
      apply: true,
      confirmPhrase: "yes please",
      journalPath,
      now: TS,
    });
    expect(result.gated).toBe(false);
    expect(result.applied).toHaveLength(0);
    expect(adapter.calls).toHaveLength(0);
    await expect(fs.access(journalPath)).rejects.toThrow();
  });
});

describe("apply mode — gated conversion + idempotency", () => {
  test("converts exactly the convertible rows once; a second run is a safe no-op", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();

    const first = await runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS });
    expect(first.gated).toBe(true);
    expect(first.applied).toHaveLength(CONVERTIBLE_ROW_IDS.length);
    expect(adapter.calls).toHaveLength(CONVERTIBLE_ROW_IDS.length);
    expect(first.applied.map((e) => e.rowId).sort()).toEqual([...CONVERTIBLE_ROW_IDS].sort());

    const second = await runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS2 });
    expect(second.applied).toHaveLength(0); // all convertible rows are now "canonical" — nothing left
    expect(adapter.calls).toHaveLength(CONVERTIBLE_ROW_IDS.length); // unchanged — no new calls
  });

  test("journal contains exactly one well-formed entry per converted row", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();
    await runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS });

    const entries = await readJournalEntries(journalPath);
    expect(entries).toHaveLength(CONVERTIBLE_ROW_IDS.length);

    for (const entry of entries) {
      expect(typeof entry.model).toBe("string");
      expect(typeof entry.rowId).toBe("number");
      expect(typeof entry.field).toBe("string");
      expect(typeof entry.before).toBe("string");
      expect(typeof entry.after).toBe("string");
      expect(entry.timestamp).toBe(TS);
      expect(entry.toolVersion).toBe(TOOL_VERSION);
      expect(Object.keys(entry).sort()).toEqual(
        ["after", "before", "field", "model", "rowId", "timestamp", "toolVersion"].sort()
      );
    }

    const specBookEntry = entries.find((e) => e.model === "SpecBook");
    expect(specBookEntry?.before).toBe(path.join(SYNTHETIC_STORAGE_ROOT, "uploads", "specbooks", "501", "original.pdf"));
    expect(specBookEntry?.after).toBe("uploads/specbooks/501/original.pdf");
    expect(specBookEntry?.field).toBe("filePath");
  });

  test("apply mode refuses to proceed (before any DB write) if the journal destination isn't writable", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    // A path whose parent directory cannot exist as a directory: a FILE
    // component in the middle of the path.
    const blockerFile = path.join(tmpDir, "not-a-directory");
    await fs.writeFile(blockerFile, "x");
    const journalPath = path.join(blockerFile, "sub", "journal.jsonl");

    await expect(
      runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS })
    ).rejects.toThrow(/not writable/i);
    expect(adapter.calls).toHaveLength(0);
  });
});

describe("reversal mode — idempotent undo", () => {
  test("reverts converted rows and is a safe no-op on a second run", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();
    await runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS });

    const firstReversal = await runReversal(adapter, journalPath);
    expect(firstReversal.reverted).toBe(CONVERTIBLE_ROW_IDS.length);
    expect(firstReversal.skipped).toBe(0);

    const specBookRows = await adapter.findRows("SpecBook");
    expect(specBookRows.find((r) => r.id === 3)?.value).toBe(
      path.join(SYNTHETIC_STORAGE_ROOT, "uploads", "specbooks", "501", "original.pdf")
    );

    const secondReversal = await runReversal(adapter, journalPath);
    expect(secondReversal.reverted).toBe(0);
    expect(secondReversal.skipped).toBe(CONVERTIBLE_ROW_IDS.length);
  });

  test("reversal skips (never errors) a row that no longer matches the journaled 'after' value", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();
    await runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS });

    // Simulate an unrelated later change to one converted row.
    await adapter.updateField("SpecBook", 3, "filePath", "plan-room/jobs/501/spec/re-uploaded.pdf");
    const callsToRow3Before = adapter.calls.filter((c) => c.model === "SpecBook" && c.rowId === 3).length;

    const reversal = await runReversal(adapter, journalPath);
    // The other 3 converted rows (SpecSection/DrawingUpload/EstimateUpload)
    // still match their journaled "after" value and DO get reverted — only
    // row 3 (tampered with) is skipped.
    expect(reversal.reverted).toBe(CONVERTIBLE_ROW_IDS.length - 1);
    expect(reversal.skipped).toBe(1);
    // No additional updateField call for row 3 beyond the manual one above —
    // reversal must never overwrite a row that no longer matches "after".
    const callsToRow3After = adapter.calls.filter((c) => c.model === "SpecBook" && c.rowId === 3).length;
    expect(callsToRow3After).toBe(callsToRow3Before);
    const row = (await adapter.findRows("SpecBook")).find((r) => r.id === 3);
    expect(row?.value).toBe("plan-room/jobs/501/spec/re-uploaded.pdf");
  });
});

describe("rows this tool must never touch, in any mode", () => {
  test("legacy-cwd rows never reach updateField", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    await buildInventoryReport(adapter, TS);
    const journalPath = nextJournalPath();
    await runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS });

    for (const call of adapter.calls) {
      expect(LEGACY_CWD_ROW_IDS).not.toContain(call.rowId);
    }
  });

  test("invalid rows never reach updateField", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    await buildInventoryReport(adapter, TS);
    const journalPath = nextJournalPath();
    await runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS });

    for (const call of adapter.calls) {
      expect(INVALID_ROW_IDS).not.toContain(call.rowId);
    }
  });

  test("AddendumUpload/Meeting rows are reported (including their null bucket) but NEVER passed to updateField, in any mode", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const report = await buildInventoryReport(adapter, TS);
    expect(report.models.AddendumUpload.null).toBe(2);
    expect(report.models.Meeting.null).toBe(2);

    const journalPath = nextJournalPath();
    await runApply(adapter, { apply: true, confirmPhrase: CONFIRM_PHRASE, journalPath, now: TS });
    await runReversal(adapter, journalPath);

    expect(adapter.calls.some((c) => c.model === "AddendumUpload" || c.model === "Meeting")).toBe(false);
  });
});

describe("classifyInventoryRow — direct unit coverage", () => {
  test("null value classifies as 'null' regardless of model, never touching a classifier", () => {
    const result = classifyInventoryRow("AddendumUpload", { id: 999, bidId: 1, value: null });
    expect(result).toEqual({ model: "AddendumUpload", rowId: 999, bucket: "null", convertible: false });
  });

  test("EstimateUpload requires subcontractorId scope", () => {
    expect(() =>
      classifyInventoryRow("EstimateUpload", { id: 1, bidId: 1, value: "/synthetic-storage-root/uploads/estimates/1/1/f.pdf" })
    ).toThrow(/subcontractorId/);
  });
});
