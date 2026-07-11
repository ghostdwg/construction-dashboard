// OPS Acceptance UX Hardening V1 — copy-contract tests.
//
// There is no React render harness in this repo (and this change must not
// invent one), so these tests pin the DISCOVERABILITY copy contract by
// reading the component sources: the exact labels, headings, hints, and
// empty states an operator acceptance walkthrough depends on. If a refactor
// drops or rewords one of these strings, the walkthrough in the deploy
// packet no longer matches the UI and this suite fails.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..");
const read = (f: string) => readFileSync(join(DIR, f), "utf8");

const tabBar = read("TabBar.tsx");
const tasksTab = read("TasksTab.tsx");
const register = read("OperationsRegisterTab.tsx");
const fieldReports = read("FieldReportsSection.tsx");
const meetings = read("MeetingsTab.tsx");

describe("navigation labeling (TabBar) — Phase 0 IA", () => {
  it("Field nav item lands on the operations tab with register-first copy", () => {
    expect(tabBar).toContain("?tab=operations");
    expect(tabBar).toContain('label="Field"');
    expect(tabBar).toContain("register · field reports");
  });

  it("Coordination group carries startup, meetings, and action items", () => {
    expect(tabBar).toContain('label="Coordination"');
    expect(tabBar).toContain("startup · meetings · action items");
    expect(tabBar).toContain("?tab=handoff");
  });

  it("Closeout and Reference are their own groups", () => {
    expect(tabBar).toContain('label="Closeout"');
    expect(tabBar).toContain("?tab=closeout");
    expect(tabBar).toContain('label="Reference"');
    expect(tabBar).toContain("warranties · training · inspections");
  });

  it("retired labels are gone", () => {
    expect(tabBar).not.toContain('label="Construction"');
    expect(tabBar).not.toContain('label="Post-Award"');
  });
});

describe("Action Items page (TasksTab reframed in place)", () => {
  it("is titled Action Items and framed as the project-wide queue", () => {
    expect(tasksTab).toContain(">Action Items</h2>");
    expect(tasksTab).toContain("project-wide execution queue");
  });

  it("no longer carries the stale cross-link crutch copy", () => {
    expect(tasksTab).not.toContain("Looking for the Operations Register");
    expect(tasksTab).not.toContain("Construction → Operations");
  });
});

describe("Operations Register heading and help copy", () => {
  it("renders the ratified heading and subtitle", () => {
    expect(register).toContain("Operations Register");
    expect(register).not.toContain("Tasks / Operations Register");
    expect(register).toContain(
      "Accountable project conditions and follow-up through resolution."
    );
  });

  it("tells users to expand a row for comments and attachments", () => {
    expect(register).toContain("Click a row to expand it and add comments and");
    expect(register).toContain("attachments.");
  });

  it("has an explicit expand affordance on rows", () => {
    expect(register).toContain('{expanded ? "▾" : "▸"}');
    expect(register).toContain("Expand to add comments and attachments");
  });

  it("labels Comments and Attachments plainly in the detail panel", () => {
    expect(register).toContain(">Comments</p>");
    expect(register).toContain("Attachments");
    expect(register).toContain(
      "jpeg/png/webp/pdf · download only — preview/OCR/AI extraction not built yet"
    );
  });

  it("renders attachment download links from attachment metadata", () => {
    expect(register).toMatch(/attachments\/\$\{a\.id\}\/download/);
  });

  it("shows an honest empty state that explains create vs promote", () => {
    expect(register).toContain("No Register Items yet. Create one manually");
    expect(register).toContain("promote a meeting action item");
  });

  it("ships the first-run acceptance walkthrough checklist", () => {
    expect(register).toContain("first-run walkthrough");
    expect(register).toContain("Create a Register Item");
    expect(register).toContain("Expand the item");
    expect(register).toContain("Add a comment");
    expect(register).toContain("Upload an attachment");
    expect(register).toContain("Download the attachment");
    expect(register).toContain("Create a Field Report");
    expect(register).toContain("Upload and download the report file");
    expect(register).toContain("Create a Register Item from that report");
  });

  it("mounts Field Reports on the same Operations surface", () => {
    expect(register).toContain('import FieldReportsSection from "./FieldReportsSection"');
    expect(register).toContain("<FieldReportsSection");
  });
});

describe("Field Reports copy", () => {
  it("uses the explicit action labels", () => {
    expect(fieldReports).toContain("New Field Report");
    expect(fieldReports).toContain("Create Register Item from this report");
    expect(fieldReports).toMatch(/"Replace file" : "Upload file"/);
    expect(fieldReports).toContain("Download");
    expect(fieldReports).toMatch(/\$\{base\}\/download/);
  });

  it("defines the surface as contractor-authored field records", () => {
    expect(fieldReports).toContain(
      "Contractor-authored project field records documenting site activity, progress,"
    );
  });

  it("has a directive empty state", () => {
    expect(fieldReports).toContain(
      "Create a Field Report to attach site reports/photos/PDFs"
    );
    expect(fieldReports).toContain("create Register Items");
  });

  it("keeps the honest no-preview/no-OCR/no-auto-extraction copy", () => {
    expect(fieldReports).toContain("download only — no preview/OCR yet");
    expect(fieldReports).toContain("nothing is auto-extracted");
    expect(fieldReports).toContain("nothing is extracted automatically");
  });
});

describe("OAC promote path (MeetingsTab)", () => {
  it("offers an explicit, human-only Promote to Tracked Item action", () => {
    expect(meetings).toContain("Promote to Tracked Item");
    expect(meetings).toContain("/tracked-items/promote");
    expect(meetings).toContain("meetingActionItemId: item.id");
  });

  it("handles already-tracked (409) honestly and never auto-promotes", () => {
    expect(meetings).toContain('"Already tracked"');
    expect(meetings).toContain("Tracked ✓");
    // promote fires only from the button's click handler
    expect(meetings).toContain("onClick={() => promoteToTracked(item)}");
    expect(meetings).not.toMatch(/useEffect\([^)]*promoteToTracked/);
  });

  it("shows an honest empty state instead of fabricated meeting data", () => {
    expect(meetings).toContain(
      "No meeting action items available to promote on this bid."
    );
  });
});

describe("scope guards", () => {
  it("touched components import no provider/Procore/AI client code", () => {
    for (const src of [tabBar, tasksTab, register, fieldReports]) {
      expect(src).not.toMatch(/@anthropic|openai|procore|lib\/services\/ai/i);
    }
    // MeetingsTab has pre-existing meeting features; the promote addition
    // itself must not have introduced provider imports.
    expect(meetings).not.toMatch(/from ["'].*(@anthropic|openai|procore)/i);
  });
});
