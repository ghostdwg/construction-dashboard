// Security hotfix (provider-readiness-secret-redaction) — pure UI-decision
// helper, extracted so it's unit-testable without a DOM-rendering harness
// (this repo has no jsdom/@testing-library setup; see the Phase 6 precedent
// in lib/services/specbook/sourceSectionLink.ts for the same pattern).
//
// Shows all three feature-scoped stub flags explicitly, every time — never
// omits an OFF flag from the list. A combined "only show what's ON" pill
// let a user overlook a flag with no visible signal either way.

export type StubModeActiveFlags = {
  BRIEF_STUB_MODE: boolean;
  GAP_STUB_MODE: boolean;
  ADDENDUM_STUB_MODE: boolean;
};

export type StubFlagRow = { name: keyof StubModeActiveFlags; on: boolean };

export function stubFlagRows(activeFlags: StubModeActiveFlags): StubFlagRow[] {
  return [
    { name: "BRIEF_STUB_MODE", on: activeFlags.BRIEF_STUB_MODE },
    { name: "GAP_STUB_MODE", on: activeFlags.GAP_STUB_MODE },
    { name: "ADDENDUM_STUB_MODE", on: activeFlags.ADDENDUM_STUB_MODE },
  ];
}
