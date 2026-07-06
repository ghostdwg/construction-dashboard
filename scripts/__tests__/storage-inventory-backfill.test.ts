// ──────────────────────────────────────────────────────────────────────────────
//  scripts/__tests__/storage-inventory-backfill.test.ts
//
//  CLI-level coverage for scripts/storage-inventory-backfill.ts: argv
//  parsing, the two-gate --apply flow, --reverse, and proof that the
//  default (no production adapter wired) path never silently no-ops — it
//  throws a clear error instead of pretending to succeed.
//
//  NO REAL DATABASE: every runMain() call here injects a FakeStorageInventoryDbAdapter
//  (the same in-memory fixture adapter the core module's own test suite
//  uses — see lib/services/storageInventory/__tests__/fixtures.ts). The only
//  real filesystem I/O is the JSON-lines journal file, written to a
//  throwaway os.tmpdir() directory — required by the journal feature itself,
//  not "storage" in the BlobStore/production sense.
// ──────────────────────────────────────────────────────────────────────────────

import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { parseArgs, runMain } from "../storage-inventory-backfill";
import {
  buildFixtureData,
  CONVERTIBLE_ROW_IDS,
  FakeStorageInventoryDbAdapter,
  SYNTHETIC_STORAGE_ROOT,
} from "@/lib/services/storageInventory/__tests__/fixtures";
import { CONFIRM_PHRASE } from "@/lib/services/storageInventory/types";

let previousStorageRoot: string | undefined;
let tmpDir: string;
let journalCounter = 0;

beforeAll(async () => {
  previousStorageRoot = process.env.STORAGE_LOCAL_PATH;
  process.env.STORAGE_LOCAL_PATH = SYNTHETIC_STORAGE_ROOT;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "storage-inventory-cli-test-"));
});

afterAll(async () => {
  if (previousStorageRoot === undefined) delete process.env.STORAGE_LOCAL_PATH;
  else process.env.STORAGE_LOCAL_PATH = previousStorageRoot;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function nextJournalPath(): string {
  journalCounter += 1;
  return path.join(tmpDir, `cli-journal-${journalCounter}.jsonl`);
}

let logSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

describe("parseArgs", () => {
  test("defaults to no apply/reverse/help", () => {
    expect(parseArgs([])).toEqual({ apply: false, reverse: false, help: false });
  });

  test("parses --apply, --confirm <phrase>, --journal <path>", () => {
    expect(parseArgs(["--apply", "--confirm", CONFIRM_PHRASE, "--journal", "/tmp/j.jsonl"])).toEqual({
      apply: true,
      reverse: false,
      help: false,
      confirm: CONFIRM_PHRASE,
      journalPath: "/tmp/j.jsonl",
    });
  });

  test("parses --reverse --journal <path>", () => {
    expect(parseArgs(["--reverse", "--journal", "/tmp/j.jsonl"])).toEqual({
      apply: false,
      reverse: true,
      help: false,
      journalPath: "/tmp/j.jsonl",
    });
  });

  test("parses --help", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

describe("runMain — default inventory mode", () => {
  test("prints a report and never calls updateField", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    await runMain([], { adapter, now: () => "2026-01-01T00:00:00.000Z" });
    expect(adapter.calls).toHaveLength(0);
    expect(logSpy).toHaveBeenCalled();
  });

  test("with no injected adapter, throws a clear error rather than silently no-oping (no real DB is wired in this deliverable)", async () => {
    await expect(runMain([], {})).rejects.toThrow(/No production database adapter is wired up/);
  });
});

describe("runMain — apply gating", () => {
  test("--apply alone (no --confirm) performs zero writes", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();
    await runMain(["--apply", "--journal", journalPath], { adapter, now: () => "2026-01-01T00:00:00.000Z" });
    expect(adapter.calls).toHaveLength(0);
    await expect(fs.access(journalPath)).rejects.toThrow();
  });

  test("--apply without --journal fails fast without touching the adapter", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    await runMain(["--apply", "--confirm", CONFIRM_PHRASE], { adapter, now: () => "2026-01-01T00:00:00.000Z" });
    expect(adapter.calls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0; // reset for subsequent tests
  });

  test("--apply --confirm <exact phrase> --journal <path> converts eligible rows and writes a journal", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();
    await runMain(["--apply", "--confirm", CONFIRM_PHRASE, "--journal", journalPath], {
      adapter,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    expect(adapter.calls).toHaveLength(CONVERTIBLE_ROW_IDS.length);
    const journalContent = await fs.readFile(journalPath, "utf8");
    const lines = journalContent.trim().split("\n");
    expect(lines).toHaveLength(CONVERTIBLE_ROW_IDS.length);
  });
});

describe("runMain — reversal", () => {
  test("--reverse --journal <path> restores converted rows and is idempotent", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    const journalPath = nextJournalPath();
    await runMain(["--apply", "--confirm", CONFIRM_PHRASE, "--journal", journalPath], {
      adapter,
      now: () => "2026-01-01T00:00:00.000Z",
    });
    const callsAfterApply = adapter.calls.length;

    await runMain(["--reverse", "--journal", journalPath], { adapter, now: () => "2026-01-02T00:00:00.000Z" });
    expect(adapter.calls.length).toBe(callsAfterApply + CONVERTIBLE_ROW_IDS.length);

    await runMain(["--reverse", "--journal", journalPath], { adapter, now: () => "2026-01-03T00:00:00.000Z" });
    // Second reversal is a no-op — no additional updateField calls.
    expect(adapter.calls.length).toBe(callsAfterApply + CONVERTIBLE_ROW_IDS.length);
  });

  test("--reverse without --journal fails fast without touching the adapter", async () => {
    const adapter = new FakeStorageInventoryDbAdapter(buildFixtureData());
    await runMain(["--reverse"], { adapter, now: () => "2026-01-01T00:00:00.000Z" });
    expect(adapter.calls).toHaveLength(0);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
