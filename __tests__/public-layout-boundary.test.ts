import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();

describe("public layout boundary", () => {
  test("the root layout cannot acquire authenticated chrome or operational queries", () => {
    const source = readFileSync(join(root, "app/layout.tsx"), "utf8");
    expect(source).not.toMatch(/lib\/prisma|AuthProvider|AppSidebar|UserNav|SessionTimeoutMonitor/);
    expect(source).not.toMatch(/\.count\s*\(/);
  });

  test("operational aggregates live only in the protected route-group layout", () => {
    const source = readFileSync(join(root, "app/(authenticated)/layout.tsx"), "utf8");
    expect(source).toMatch(/lib\/prisma/);
    expect(source).toMatch(/AppSidebar/);
    expect(source).toMatch(/AuthProvider/);
  });
});
