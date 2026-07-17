import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Static guards for the R2-B1 meeting workspace UI (navRecovery.test.ts
// style). The e2e suite (e2e/meetingRegister.spec.ts) proves the flows in a
// real browser; these assertions pin the load-bearing UI surface — section
// tabs, disposition/promotion action strings, the minutes publish gate and
// the correction-op vocabulary — so a refactor that silently drops one is
// caught without booting Playwright.

const bidDir = join(__dirname, "..", "app", "bids", "[id]");

describe("MeetingsTab.tsx meeting workspace section tabs", () => {
  const tab = readFileSync(join(bidDir, "MeetingsTab.tsx"), "utf8");

  it("renders the five section tabs including register and minutes", () => {
    expect(tab).toMatch(
      /\(\["transcript", "analysis", "register", "minutes", "items"\] as const\)/
    );
    expect(tab).toMatch(/\{s === "register" && "Register"\}/);
    expect(tab).toMatch(/\{s === "minutes" && "Minutes"\}/);
  });

  it("mounts the three R2-B1 panels", () => {
    for (const panel of [
      "<MeetingRegisterPanel",
      "<MeetingMinutesPanel",
      "<TranscriptReviewPanel",
    ]) {
      expect(tab).toContain(panel);
    }
  });
});

describe("MeetingRegisterPanel.tsx disposition and promotion actions", () => {
  const panel = readFileSync(join(bidDir, "MeetingRegisterPanel.tsx"), "utf8");

  it("offers all 8 disposition/promotion action strings on entry cards", () => {
    for (const action of [
      ">Confirm<",
      ">Correct…<",
      ">Discussion only<",
      ">Informational<",
      ">Merge/dup…<",
      ">Dismiss…<",
      ">Promote to Operations…<",
      ">Link existing…<",
    ]) {
      expect(panel).toContain(action);
    }
  });
});

describe("MeetingMinutesPanel.tsx publish gate", () => {
  const panel = readFileSync(join(bidDir, "MeetingMinutesPanel.tsx"), "utf8");

  it("derives canPublish from register coverage fullyReviewed", () => {
    expect(panel).toMatch(/canPublish = coverage\?\.fullyReviewed \?\? false/);
  });

  it("disables the publish button when not fully reviewed and requires an amendment reason", () => {
    expect(panel).toMatch(
      /disabled=\{busy \|\| !canPublish \|\| \(hasRevisions && !amendReason\.trim\(\)\)\}/
    );
  });
});

describe("TranscriptReviewPanel.tsx correction operations", () => {
  const panel = readFileSync(join(bidDir, "TranscriptReviewPanel.tsx"), "utf8");

  it("posts all 7 audited correction ops", () => {
    for (const op of [
      "RENAME_SPEAKER",
      "REASSIGN_SEGMENT",
      "REASSIGN_ALL_MATCHING",
      "MERGE_SPEAKERS",
      "SPLIT_SEGMENT",
      "MARK_UNKNOWN",
      "EDIT_TEXT",
    ]) {
      expect(panel).toContain(`correctionType: "${op}"`);
    }
  });
});
