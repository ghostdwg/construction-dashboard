export type TabKey =
  | "overview"
  | "documents" | "trades" | "subs" | "scope" | "ai-review"
  | "questions" | "leveling" | "activity"
  | "handoff" | "submittals" | "schedule" | "meetings" | "briefing" | "procore"
  | "warranties" | "training" | "inspections" | "closeout";

export const PURSUIT_KEYS = new Set<TabKey>([
  "documents", "trades", "subs", "scope", "ai-review",
  "questions", "leveling", "activity",
]);

export const POST_AWARD_KEYS = new Set<TabKey>([
  "handoff", "submittals", "schedule", "meetings", "briefing", "procore",
]);

export const CONSTRUCTION_KEYS = new Set<TabKey>([
  "warranties", "training", "inspections", "closeout",
]);

export const PURSUIT_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "documents",  label: "DOCS"         },
  { key: "trades",     label: "TRADES"       },
  { key: "subs",       label: "SUBS"         },
  { key: "scope",      label: "SCOPE"        },
  { key: "ai-review",  label: "INTELLIGENCE" },
  { key: "questions",  label: "QUESTIONS"    },
  { key: "leveling",   label: "LEVELING"     },
  { key: "activity",   label: "ACTIVITY"     },
];

export const POST_AWARD_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "handoff",    label: "HANDOFF"    },
  { key: "submittals", label: "SUBMITTALS" },
  { key: "schedule",   label: "SCHEDULE"   },
  { key: "meetings",   label: "MEETINGS"   },
  { key: "briefing",   label: "BRIEFING"   },
  { key: "procore",    label: "PROCORE"    },
];

export const CONSTRUCTION_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "warranties",  label: "WARRANTIES"  },
  { key: "training",    label: "TRAINING"    },
  { key: "inspections", label: "INSPECTIONS" },
  { key: "closeout",    label: "CLOSEOUT"    },
];
