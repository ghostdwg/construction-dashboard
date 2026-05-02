import { describe, expect, it } from "vitest";

process.env.DATABASE_URL ??= "file:./dev.db";

const toYMD = (d: Date) => d.toISOString().slice(0, 10);

describe("schedule working-day math", async () => {
  const { addWorkingDays } = await import("../lib/services/schedule/scheduleV2Service");

  it("keeps the same date for zero working days", () => {
    expect(toYMD(addWorkingDays(new Date("2026-05-04T00:00:00.000Z"), 0))).toBe("2026-05-04");
  });

  it("skips weekends when adding working days", () => {
    expect(toYMD(addWorkingDays(new Date("2026-05-08T00:00:00.000Z"), 1))).toBe("2026-05-11");
  });

  it("spans a full work week from Monday to the following Monday", () => {
    expect(toYMD(addWorkingDays(new Date("2026-05-04T00:00:00.000Z"), 5))).toBe("2026-05-11");
  });
});
