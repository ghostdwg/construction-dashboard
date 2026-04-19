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
  { key: "documents",  label: "Documents"  },
  { key: "trades",     label: "Trades"     },
  { key: "subs",       label: "Subs"       },
  { key: "scope",      label: "Scope"      },
  { key: "ai-review",  label: "AI Review"  },
  { key: "questions",  label: "Questions"  },
  { key: "leveling",   label: "Leveling"   },
  { key: "activity",   label: "Activity"   },
];

export const POST_AWARD_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "handoff",    label: "Handoff"    },
  { key: "submittals", label: "Submittals" },
  { key: "schedule",   label: "Schedule"   },
  { key: "meetings",   label: "Meetings"   },
  { key: "briefing",   label: "Briefing"   },
  { key: "procore",    label: "Procore"    },
];

export const CONSTRUCTION_SUBTABS: { key: TabKey; label: string }[] = [
  { key: "warranties",  label: "Warranties"  },
  { key: "training",    label: "Training"    },
  { key: "inspections", label: "Inspections" },
  { key: "closeout",    label: "Closeout"    },
];
