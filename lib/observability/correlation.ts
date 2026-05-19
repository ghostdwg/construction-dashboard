// ──────────────────────────────────────────────────────────────────────────────
//  lib/observability/correlation.ts
//  Phase O1.2 — Request-scoped correlation IDs via AsyncLocalStorage.
//
//  Every emitAuditEvent() call inherits ambient correlation context. The
//  context is populated at the boundary (API route, runner cycle entry,
//  replay-validation script) and propagates transparently through async
//  call chains.
//
//  Three boundary kinds:
//
//    1. Web request — Next.js middleware OR per-route helper installs a
//       correlationId from the inbound `x-correlation-id` header (or
//       generates one). Bound for the lifetime of the request.
//
//    2. Runner cycle — the (future O2) cron container generates a
//       runnerId per cycle; every audit event emitted within the cycle
//       carries it.
//
//    3. Replay/backfill — replay-validation.mjs and the backfill scripts
//       generate a replayId at start and propagate it.
// ──────────────────────────────────────────────────────────────────────────────

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { ActorKind } from "./taxonomy";

export interface CorrelationContext {
  correlationId: string | null;
  replayId: string | null;
  ingestionId: string | null;
  runnerId: string | null;
  actorKind: ActorKind | null;
  actorUserId: string | null;
  actorEmail: string | null;
}

const EMPTY: CorrelationContext = {
  correlationId: null,
  replayId: null,
  ingestionId: null,
  runnerId: null,
  actorKind: null,
  actorUserId: null,
  actorEmail: null,
};

const storage = new AsyncLocalStorage<CorrelationContext>();

/** Read the ambient correlation context. Returns empty struct outside a
 *  context — safe to call from anywhere. */
export function currentCorrelationContext(): CorrelationContext {
  return storage.getStore() ?? EMPTY;
}

/** Run a function with a correlation context bound. Nested calls inherit
 *  parent values for unset fields, allowing scope refinement (e.g. an
 *  inner replay block can add replayId on top of an outer correlationId). */
export function withCorrelationContext<T>(
  partial: Partial<CorrelationContext>,
  fn: () => T
): T {
  const parent = storage.getStore() ?? EMPTY;
  const merged: CorrelationContext = { ...parent, ...partial };
  return storage.run(merged, fn);
}

/** Async variant of withCorrelationContext for use with Promise-returning
 *  callbacks. */
export function withCorrelationContextAsync<T>(
  partial: Partial<CorrelationContext>,
  fn: () => Promise<T>
): Promise<T> {
  const parent = storage.getStore() ?? EMPTY;
  const merged: CorrelationContext = { ...parent, ...partial };
  return storage.run(merged, fn);
}

/** Generate a new correlation id. Format: `crl_<uuid>`. */
export function newCorrelationId(): string {
  return `crl_${randomUUID()}`;
}

/** Generate a new replay id. Format: `rep_<uuid>`. */
export function newReplayId(): string {
  return `rep_${randomUUID()}`;
}

/** Generate a new runner-cycle id. Format: `run_<runnerName>_<uuid>`. */
export function newRunnerId(runnerName: string): string {
  return `run_${runnerName}_${randomUUID()}`;
}

/** Generate a new ingestion batch id. Format: `ing_<uuid>`. */
export function newIngestionId(): string {
  return `ing_${randomUUID()}`;
}
