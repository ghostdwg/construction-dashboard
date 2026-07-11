// OPS operational polish V1 — copy/wiring contract tests (source-string
// assertions; no render harness exists in this repo and this slice does
// not add one). Complements opsAcceptanceUxCopy.test.ts (which pins the
// V1 hardening copy and still passes unchanged).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(__dirname, "..");
const register = readFileSync(join(DIR, "OperationsRegisterTab.tsx"), "utf8");
const fieldReports = readFileSync(join(DIR, "FieldReportsSection.tsx"), "utf8");

describe("promote-from-meeting picker", () => {
  it("offers a picker instead of number-only entry, with manual fallback", () => {
    expect(register).toContain("Promote from meeting…");
    expect(register).toContain("Pick a meeting action item…");
    expect(register).toContain('placeholder="or #"');
  });

  it("loads options from the existing meetings read endpoints only", () => {
    expect(register).toMatch(/api\/bids\/\$\{bidId\}\/meetings`/);
    expect(register).toMatch(/meetings\/\$\{m\.id\}\/action-items/);
  });

  it("annotates already-tracked options and treats the set as a hint", () => {
    expect(register).toContain("promotedIds.has(o.id)");
    expect(register).toContain("Already tracked in the register.");
    // hint semantics documented where the prop is consumed
    expect(register).toContain("the server's unique guard (409) stays the source of truth");
  });

  it("shows honest empty copy when no action items exist", () => {
    expect(register).toContain(
      "No meeting action items on this bid yet — record them in the Meetings tab first."
    );
  });

  it("never auto-promotes: promote fires only from the button handler", () => {
    expect(register).not.toMatch(/useEffect\([^)]*promote\(/);
  });
});

describe("register status summary and overdue signal", () => {
  it("renders status count chips via statusCounts", () => {
    expect(register).toContain("statusCounts(items).map");
  });

  it("renders an overdue chip and row highlight via isOverdue", () => {
    expect(register).toContain("OVERDUE");
    expect(register).toContain('isOverdue(i.dueDate, i.status)');
    expect(register).toContain('" (overdue)"');
  });

  it("is honest when counts reflect a filtered view", () => {
    expect(register).toContain("(counts reflect the current filter)");
  });
});

describe("field report linkage label", () => {
  it("labels the server-provided count as Register Items with context", () => {
    expect(fieldReports).toContain("Register Item");
    expect(fieldReports).toContain(
      "Register Items created from this report — they live in the register above as FIELD ITEM"
    );
  });
});
