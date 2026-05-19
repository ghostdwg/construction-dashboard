// Phase O1.4 — windowKey derivation tests.

import { describe, expect, test } from "vitest";
import { deriveWindow } from "../windowKey";

const T_2026_05_19_18_43_UTC = new Date("2026-05-19T18:43:21.000Z");

describe("deriveWindow — daily", () => {
  test("rounds down to UTC midnight and formats ISO date", () => {
    const w = deriveWindow("forecast-daily", "daily", T_2026_05_19_18_43_UTC);
    expect(w.windowKey).toBe("forecast-daily_2026-05-19");
    expect(w.windowStart.toISOString()).toBe("2026-05-19T00:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-05-20T00:00:00.000Z");
  });

  test("same calendar day → same windowKey regardless of time-of-day", () => {
    const a = deriveWindow("forecast-daily", "daily", new Date("2026-05-19T01:00:00Z"));
    const b = deriveWindow("forecast-daily", "daily", new Date("2026-05-19T23:59:00Z"));
    expect(a.windowKey).toBe(b.windowKey);
  });

  test("different calendar days → different windowKey", () => {
    const a = deriveWindow("forecast-daily", "daily", new Date("2026-05-19T23:59:00Z"));
    const b = deriveWindow("forecast-daily", "daily", new Date("2026-05-20T00:00:01Z"));
    expect(a.windowKey).not.toBe(b.windowKey);
  });
});

describe("deriveWindow — hourly", () => {
  test("rounds down to the hour", () => {
    const w = deriveWindow("alert-hourly", "hourly", T_2026_05_19_18_43_UTC);
    expect(w.windowKey).toBe("alert-hourly_2026-05-19T18");
    expect(w.windowStart.toISOString()).toBe("2026-05-19T18:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-05-19T19:00:00.000Z");
  });
});

describe("deriveWindow — weekly", () => {
  test("rounds to ISO Monday", () => {
    // Tuesday May 19 2026 → Monday May 18
    const w = deriveWindow("calibration-weekly", "weekly", new Date("2026-05-19T12:00:00Z"));
    expect(w.windowStart.toISOString()).toBe("2026-05-18T00:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-05-25T00:00:00.000Z");
    expect(w.windowKey).toMatch(/^calibration-weekly_2026-W\d{2}$/);
  });

  test("Monday is its own ISO week start", () => {
    const a = deriveWindow("calibration-weekly", "weekly", new Date("2026-05-18T00:00:00Z"));
    const b = deriveWindow("calibration-weekly", "weekly", new Date("2026-05-18T23:59:00Z"));
    expect(a.windowKey).toBe(b.windowKey);
  });
});

describe("deriveWindow — monthly", () => {
  test("rounds to first day of month", () => {
    const w = deriveWindow("retention-monthly", "monthly", T_2026_05_19_18_43_UTC);
    expect(w.windowStart.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(w.windowEnd.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(w.windowKey).toBe("retention-monthly_2026-05");
  });
});

describe("deriveWindow — manual", () => {
  test("requires explicit windowKey override", () => {
    expect(() => deriveWindow("backfill", "manual", new Date())).toThrow(/windowKey override/);
  });

  test("uses provided override verbatim with cycleName prefix", () => {
    const w = deriveWindow("backfill", "manual", new Date(), { windowKey: "entities-2026" });
    expect(w.windowKey).toBe("backfill_entities-2026");
  });
});

describe("deriveWindow — windowKey override on non-manual granularity", () => {
  test("override wins even when granularity would auto-derive", () => {
    const w = deriveWindow("forecast-daily", "daily", T_2026_05_19_18_43_UTC, {
      windowKey: "operator-replay-1",
    });
    expect(w.windowKey).toBe("forecast-daily_operator-replay-1");
  });
});
