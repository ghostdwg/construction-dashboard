// Quick Push — shared types used by quickPushService, route handlers, and UI.

export type StepName =
  | "award"
  | "create_project"
  | "vendors"
  | "submittals"
  | "schedule"
  | "budget"
  | "confirm";

export const STEP_NAMES: StepName[] = [
  "award",
  "create_project",
  "vendors",
  "submittals",
  "schedule",
  "budget",
  "confirm",
];

export type StepState =
  | "pending"
  | "running"
  | "done"
  | "done_with_errors"
  | "skipped"
  | "failed";

export type StepResult = {
  state: StepState;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
  // vendors / submittals / budget
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: string[];
  // create_project
  procoreProjectId?: string;
  linkedExisting?: boolean;
  // schedule
  importId?: number | null;
  activityCount?: number;
  procoreStatus?: string | null;
  // http errors
  httpStatus?: number;
  error?: string;
};

export type StepResults = Record<StepName, StepResult>;

export function emptyStepResults(): StepResults {
  const pending: StepResult = { state: "pending" };
  return {
    award: { ...pending },
    create_project: { ...pending },
    vendors: { ...pending },
    submittals: { ...pending },
    schedule: { ...pending },
    budget: { ...pending },
    confirm: { ...pending },
  };
}

// SSE event shapes emitted by the POST route
export type SseStepEvent = {
  step: StepName;
  state: StepState;
  detail?: string;
  procoreProjectId?: string;
  linkedExisting?: boolean;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: string[];
  importId?: number | null;
  activityCount?: number;
  procoreStatus?: string | null;
  httpStatus?: number;
  error?: string;
};

export type SseCompleteEvent = {
  ok: true;
  procoreProjectId: string | null;
  stepResults: StepResults;
};

export type SseFailedEvent = {
  ok: false;
  failedAt: StepName;
  error: string;
  stepResults: StepResults;
};

export type SsePreflight = {
  counts: {
    vendors: number;
    submittals: number;
    scheduleActivities: number;
    budgetLines: number;
  };
};
