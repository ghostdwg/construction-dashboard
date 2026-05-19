// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/entityGovernance/types.ts
//  Phase MI-4 — Operator governance action types.
// ──────────────────────────────────────────────────────────────────────────────

import type { ReviewState } from "@/lib/services/entityResolver";

export interface GovernanceActorContext {
  /** User id from the auth session. Null when AUTH_DISABLED=true (solo dev). */
  userId: string | null;
  /** Email for audit logging. */
  email: string | null;
}

export interface GovernanceResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface MergePlan {
  sourceEntityId: string;
  targetEntityId: string;
  aliasesToMove: number;
  relationshipsToRepoint: number;
}

export interface AliasInput {
  alias: string;
  confidence?: "LOW" | "MEDIUM" | "HIGH" | "VERIFIED";
}

export const TERMINAL_REVIEW_STATES: ReviewState[] = ["VERIFIED", "REJECTED"];
