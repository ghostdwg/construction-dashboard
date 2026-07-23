export type TabKey =
  | "overview"
  | "documents" | "trades" | "subs" | "scope" | "decisions" | "ai-review"
  | "questions" | "leveling" | "activity"
  | "handoff" | "submittals" | "schedule" | "meetings" | "tasks" | "briefing" | "procore"
  | "warranties" | "training" | "inspections" | "closeout"
  | "spec-sections" | "spec-requirements" | "spec-addenda"
  | "operations";

export const PURSUIT_KEYS = new Set<TabKey>([
  "documents", "trades", "subs", "scope", "decisions", "ai-review",
  "questions", "leveling", "activity",
]);

// Phase 0 IA: the former Post-Award group, reframed as the PM Coordination
// workspace. Internal tab keys are compatibility identifiers and never
// change — `handoff` renders the Startup workspace, `tasks` renders the
// Action Items queue.
export const COORDINATION_KEYS = new Set<TabKey>([
  "handoff", "meetings", "tasks", "submittals", "schedule", "briefing", "procore",
]);

// Field workspace. Field Reports live inside the Register page (embedded
// section), not as a separate tab key.
export const FIELD_KEYS = new Set<TabKey>([
  "operations",
]);

export const CLOSEOUT_KEYS = new Set<TabKey>([
  "closeout",
]);

// Read-only spec-requirement views ("what the SPEC requires"), distinct
// from the execution surfaces above.
export const REFERENCE_KEYS = new Set<TabKey>([
  "warranties", "training", "inspections",
  "spec-sections", "spec-requirements", "spec-addenda",
]);

export const PURSUIT_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "documents",  label: "DOCS"         },
  { key: "trades",     label: "TRADES"       },
  { key: "subs",       label: "SUBS"         },
  { key: "scope",      label: "SCOPE"        },
  { key: "decisions",  label: "DECISIONS"    },
  { key: "ai-review",  label: "INTELLIGENCE" },
  { key: "questions",  label: "QUESTIONS"    },
  { key: "leveling",   label: "LEVELING"     },
  { key: "activity",   label: "ACTIVITY"     },
];

export const COORDINATION_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "handoff",    label: "STARTUP"      },
  { key: "meetings",   label: "MEETINGS"     },
  { key: "tasks",      label: "ACTION ITEMS" },
  { key: "submittals", label: "SUBMITTALS"   },
  { key: "schedule",   label: "SCHEDULE"     },
  { key: "briefing",   label: "BRIEFING"     },
  { key: "procore",    label: "PROCORE"      },
];

export const FIELD_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "operations", label: "REGISTER" },
];

export const CLOSEOUT_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "closeout", label: "CLOSEOUT" },
];

export const REFERENCE_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "spec-sections",     label: "SECTIONS"            },
  { key: "spec-requirements", label: "REQUIREMENTS"        },
  { key: "spec-addenda",      label: "ADDENDA / VERSIONS"  },
  { key: "warranties",  label: "WARRANTIES"  },
  { key: "training",    label: "TRAINING"    },
  { key: "inspections", label: "INSPECTIONS" },
];
