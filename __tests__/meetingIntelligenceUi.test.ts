import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Meeting Intelligence local-worker UI boundary", () => {
  const panel = readFileSync(
    join(
      process.cwd(),
      "app/(authenticated)/bids/[id]/MeetingIntelligencePanel.tsx",
    ),
    "utf8",
  );
  const workspace = readFileSync(
    join(process.cwd(), "app/(authenticated)/bids/[id]/MeetingsTab.tsx"),
    "utf8",
  );

  it("is mounted in the meeting workspace and states the local-only/dev boundary", () => {
    expect(workspace).toContain("<MeetingIntelligencePanel");
    expect(workspace).toContain("Review Ledger");
    expect(panel).toContain("Local Only confidentiality boundary");
    expect(panel).toContain("durable queue calls no external AI service");
    expect(panel).toContain("deterministic development tooling");
  });

  it("renders honest media, not-processed, failure, review, and publish states", () => {
    expect(panel).toContain("Meeting Intelligence is not ready: upload meeting media first.");
    expect(panel).toContain("Transcript artifact");
    expect(panel).toContain("Processing failed");
    expect(panel).toContain("Reviewable task ledger");
    expect(panel).toContain("Publish to Action Items");
    expect(panel).toContain("Waiting for a private local worker");
    expect(panel).toContain("Stage:");
    expect(panel).toContain("Cancel processing");
    expect(panel).toContain("Retry on private worker");
  });
});
