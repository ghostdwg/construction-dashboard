import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "file:./dev.db";

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

describe("schedule working-day math", () => {
  it("keeps the same date for zero working days", async () => {
    const { addWorkingDays } = await import("../lib/services/schedule/scheduleV2Service");

    expect(isoDate(addWorkingDays(new Date("2026-05-04T00:00:00.000Z"), 0))).toBe("2026-05-04");
  });

  it("skips weekends when adding working days", async () => {
    const { addWorkingDays } = await import("../lib/services/schedule/scheduleV2Service");

    expect(isoDate(addWorkingDays(new Date("2026-05-08T00:00:00.000Z"), 1))).toBe("2026-05-11");
  });

  it("spans a full work week from Monday to the following Monday", async () => {
    const { addWorkingDays } = await import("../lib/services/schedule/scheduleV2Service");

    expect(isoDate(addWorkingDays(new Date("2026-05-04T00:00:00.000Z"), 5))).toBe("2026-05-11");
  });
});
