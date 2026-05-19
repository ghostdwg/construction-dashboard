// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/projectGovernance/types.ts
//  Phase MI-6 PR3 — Operator governance action types.
// ──────────────────────────────────────────────────────────────────────────────

import type { LifecycleState } from "@/lib/services/projectAggregation";

export interface GovernanceActorContext {
  /** Auth.js session user id; null when AUTH_DISABLED=true. */
  userId: string | null;
  /** Operator email for audit attribution. */
  email: string | null;
}

export interface GovernanceResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ProjectMergePlan {
  sourceProjectId: string;
  targetProjectId: string;
  signalsToMove: number;
  entitiesToMove: number;
  parcelsToMove: number;
}

export interface TransitionStateRequest {
  projectId: string;
  toState: LifecycleState;
  reason: string;
  override?: boolean;
}
