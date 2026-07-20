import { describe, expect, test, vi } from "vitest";
import { main, parseArgs } from "../verify-storage-convergence";

describe("verify-storage-convergence", () => {
  test("parses the explicitly scoped execute form", () => {
    expect(
      parseArgs(["--execute", "--domain", "meeting", "--bid-id", "7", "--record-id", "11"]),
    ).toEqual({ execute: true, domain: "meeting", bidId: 7, recordId: 11 });
  });

  test("default invocation is a non-destructive dry run", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(main([])).resolves.toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("no Prisma or BlobStore calls");
    log.mockRestore();
  });

  test("execute refuses incomplete scope without importing runtime dependencies", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(main(["--execute", "--domain", "drawing"])).resolves.toBe(2);
    log.mockRestore();
  });
});
