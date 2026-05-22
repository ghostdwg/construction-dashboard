// ──────────────────────────────────────────────────────────────────────────────
//  scripts/__tests__/cron-loop.test.ts
//  Phase O2.2 PR4 — Pure-helper tests for the cron loop.
//
//  Exercises:
//    * parseCronExpr — all four supported shapes + invalid input
//    * pickDueRunners — match-by-minute decision
//    * startOfMinute — UTC rounding
//
//  The full cron loop (timer + spawn + shutdown drain) is integration territory
//  and is exercised in the docker-compose validation; this file covers the
//  decision logic that determines correctness.
// ──────────────────────────────────────────────────────────────────────────────

import { describe, expect, test } from "vitest";

// ESM import from the .mjs file. Vitest handles cross-extension imports.
import {
  parseCronExpr,
  pickDueRunners,
  startOfMinute,
} from "../cron-loop.mjs";

function utc(iso: string): Date {
  return new Date(iso);
}

describe("parseCronExpr — every-N-minutes (\"*/N * * * *\")", () => {
  test('*/5 matches minutes 0, 5, 10, 15 ...', () => {
    const m = parseCronExpr("*/5 * * * *");
    expect(m.match(utc("2026-05-21T12:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T12:05:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T12:10:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T12:01:00Z"))).toBe(false);
    expect(m.match(utc("2026-05-21T12:04:00Z"))).toBe(false);
  });

  test('*/15 matches minutes 0, 15, 30, 45', () => {
    const m = parseCronExpr("*/15 * * * *");
    expect(m.match(utc("2026-05-21T03:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T03:15:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T03:30:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T03:45:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T03:14:00Z"))).toBe(false);
  });

  test('*/1 matches every minute', () => {
    const m = parseCronExpr("*/1 * * * *");
    expect(m.match(utc("2026-05-21T03:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T03:01:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T03:59:00Z"))).toBe(true);
  });
});

describe("parseCronExpr — single-minute (\"M * * * *\")", () => {
  test('"0 * * * *" matches the top of every hour', () => {
    const m = parseCronExpr("0 * * * *");
    expect(m.match(utc("2026-05-21T00:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T05:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T23:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T05:01:00Z"))).toBe(false);
    expect(m.match(utc("2026-05-21T05:59:00Z"))).toBe(false);
  });

  test('"30 * * * *" matches minute 30 of every hour', () => {
    const m = parseCronExpr("30 * * * *");
    expect(m.match(utc("2026-05-21T05:30:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T17:30:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T17:29:00Z"))).toBe(false);
  });
});

describe("parseCronExpr — daily (\"M H * * *\")", () => {
  test('"0 3 * * *" matches 03:00 UTC daily', () => {
    const m = parseCronExpr("0 3 * * *");
    expect(m.match(utc("2026-05-21T03:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-22T03:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-21T03:01:00Z"))).toBe(false);
    expect(m.match(utc("2026-05-21T04:00:00Z"))).toBe(false);
  });
});

describe("parseCronExpr — day-of-week (\"M H * * D\")", () => {
  test('"0 14 * * 5" matches Friday 14:00 UTC only', () => {
    const m = parseCronExpr("0 14 * * 5");
    // 2026-05-22 is a Friday.
    expect(m.match(utc("2026-05-22T14:00:00Z"))).toBe(true);
    // 2026-05-23 is Saturday.
    expect(m.match(utc("2026-05-23T14:00:00Z"))).toBe(false);
    // Friday at the wrong hour.
    expect(m.match(utc("2026-05-22T13:00:00Z"))).toBe(false);
  });

  test('"0 0 * * 0" matches Sunday midnight', () => {
    const m = parseCronExpr("0 0 * * 0");
    // 2026-05-24 is a Sunday.
    expect(m.match(utc("2026-05-24T00:00:00Z"))).toBe(true);
    expect(m.match(utc("2026-05-22T00:00:00Z"))).toBe(false);
  });
});

describe("parseCronExpr — input validation", () => {
  test("non-string input throws", () => {
    expect(() => parseCronExpr(42)).toThrow(/string/);
  });

  test("wrong field count throws", () => {
    expect(() => parseCronExpr("* * *")).toThrow(/5 fields/);
    expect(() => parseCronExpr("* * * * * *")).toThrow(/5 fields/);
  });

  test("non-* day-of-month or month rejected (minimal parser)", () => {
    expect(() => parseCronExpr("0 0 1 * *")).toThrow(/day-of-month and month/);
    expect(() => parseCronExpr("0 0 * 5 *")).toThrow(/day-of-month and month/);
  });

  test("invalid step rejected", () => {
    expect(() => parseCronExpr("*/0 * * * *")).toThrow();
    expect(() => parseCronExpr("*/-3 * * * *")).toThrow();
  });

  test("out-of-range single integer rejected", () => {
    expect(() => parseCronExpr("60 * * * *")).toThrow(/out of range/);
    expect(() => parseCronExpr("0 24 * * *")).toThrow(/out of range/);
    expect(() => parseCronExpr("0 0 * * 7")).toThrow(/out of range/);
  });

  test("unsupported syntax (lists, ranges) rejected", () => {
    expect(() => parseCronExpr("1,2,3 * * * *")).toThrow();
    expect(() => parseCronExpr("1-5 * * * *")).toThrow();
  });
});

describe("startOfMinute", () => {
  test("strips seconds + milliseconds (UTC)", () => {
    const d = new Date("2026-05-21T12:34:56.789Z");
    const r = startOfMinute(d);
    expect(r.toISOString()).toBe("2026-05-21T12:34:00.000Z");
  });

  test("preserves minute boundary unchanged", () => {
    const d = new Date("2026-05-21T12:34:00.000Z");
    const r = startOfMinute(d);
    expect(r.toISOString()).toBe(d.toISOString());
  });
});

describe("pickDueRunners — schedule decision", () => {
  test("returns only entries whose match() fires for the given minute", () => {
    const schedule = [
      { cron: "*/15 * * * *", runner: "health-check", trigger: "scheduled", match: parseCronExpr("*/15 * * * *").match },
      { cron: "0 * * * *",    runner: "municipal-agenda-ingestion", trigger: "scheduled", match: parseCronExpr("0 * * * *").match },
      { cron: "0 3 * * *",    runner: "forecast-daily", trigger: "scheduled", match: parseCronExpr("0 3 * * *").match },
    ];

    // 03:00 UTC — all three fire (the hour boundary is at minute 0 = multiple of 15).
    const at0300 = pickDueRunners(schedule, utc("2026-05-21T03:00:00Z"));
    expect(at0300.map((e) => e.runner).sort()).toEqual(["forecast-daily", "health-check", "municipal-agenda-ingestion"]);

    // 03:15 UTC — only health-check fires.
    const at0315 = pickDueRunners(schedule, utc("2026-05-21T03:15:00Z"));
    expect(at0315.map((e) => e.runner)).toEqual(["health-check"]);

    // 03:30 UTC — only health-check.
    const at0330 = pickDueRunners(schedule, utc("2026-05-21T03:30:00Z"));
    expect(at0330.map((e) => e.runner)).toEqual(["health-check"]);

    // 03:01 UTC — nothing fires.
    const at0301 = pickDueRunners(schedule, utc("2026-05-21T03:01:00Z"));
    expect(at0301).toEqual([]);
  });
});
