import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Regression guard for GWX-Q03.1: Next's standalone output trace never
// bundles pdfjs-dist (it's a serverExternalPackages entry, next.config.ts),
// and pdfjs-dist's pdf.mjs sets GlobalWorkerOptions.workerSrc from a plain
// string rather than a statically-traceable import, so the runner image
// silently shipped without pdf.worker.mjs. The fix is a Dockerfile COPY line
// alongside the other standalone-trace-gap packages (@prisma, @libsql, ...).
describe("Dockerfile ships the pdfjs-dist worker asset", () => {
  const dockerfile = readFileSync(join(__dirname, "..", "Dockerfile"), "utf8");

  it("explicitly copies pdfjs-dist into the runner stage's node_modules", () => {
    expect(dockerfile).toMatch(
      /COPY --from=builder \/app\/node_modules\/pdfjs-dist \.\/node_modules\/pdfjs-dist/,
    );
  });

  it("the copied package still ships the legacy build worker file locally", () => {
    const workerPath = join(
      __dirname,
      "..",
      "node_modules",
      "pdfjs-dist",
      "legacy",
      "build",
      "pdf.worker.mjs",
    );
    expect(existsSync(workerPath)).toBe(true);
  });
});
