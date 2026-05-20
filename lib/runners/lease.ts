// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/lease.ts
//  Phase O1.4 — Lease primitives for at-most-once cycle execution.
//
//  Atomic claim via UNIQUE constraint on RunnerLease.windowKey. The first
//  caller wins; subsequent claimers see the P2002 unique-violation and
//  treat their invocation as preempted (no-op success).
//
//  Heartbeat extends leaseExpiresAt + bumps lastHeartbeatAt. A holder whose
//  heartbeats stop is detectable via `findStale()` once leaseExpiresAt is
//  in the past.
// ──────────────────────────────────────────────────────────────────────────────

import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { RunnerInstanceId, RunnerLeaseState } from "./types";
import { isUniqueConstraintError } from "./uniqueConstraintError";

export interface ClaimLeaseInput {
  cycleName: string;
  windowKey: string;
  leaseSeconds: number;
  runnerId: string;
  replayId?: string | null;
}

export interface ClaimedLease {
  leaseId: string;
  leaseToken: string;
  leasedBy: string;
  leasedAt: Date;
  leaseExpiresAt: Date;
}

export type ClaimLeaseResult =
  | { ok: true; lease: ClaimedLease }
  | { ok: false; reason: "already_held" | "db_error"; details?: string };

export function currentInstance(): RunnerInstanceId {
  return {
    hostname: hostname(),
    pid: process.pid,
    instance: process.env.RUNNER_INSTANCE_ID ?? randomUUID().slice(0, 8),
  };
}

export function instanceLabel(inst: RunnerInstanceId): string {
  return `${inst.hostname}:${inst.pid}:${inst.instance}`;
}

/**
 * Atomic lease claim. Returns ok=true with lease details on success,
 * ok=false with reason="already_held" when another runner already
 * claimed this window. Idempotent across replays — a stale lease
 * (already finished, succeeded/failed) for the same windowKey causes
 * the new claim to be rejected; operator must clear it or wait for
 * the next window.
 */
export async function claimLease(input: ClaimLeaseInput): Promise<ClaimLeaseResult> {
  const inst = currentInstance();
  const leasedBy = instanceLabel(inst);
  const leaseToken = randomUUID();
  const leasedAt = new Date();
  const leaseExpiresAt = new Date(leasedAt.getTime() + input.leaseSeconds * 1000);

  try {
    const row = await prisma.runnerLease.create({
      data: {
        cycleName: input.cycleName,
        windowKey: input.windowKey,
        status: "claimed",
        leaseToken,
        leasedBy,
        leasedAt,
        leaseExpiresAt,
        lastHeartbeatAt: leasedAt,
        runnerId: input.runnerId,
        replayId: input.replayId ?? null,
      },
    });
    return {
      ok: true,
      lease: {
        leaseId: row.id,
        leaseToken: row.leaseToken,
        leasedBy: row.leasedBy,
        leasedAt: row.leasedAt,
        leaseExpiresAt: row.leaseExpiresAt,
      },
    };
  } catch (err: unknown) {
    // O1.5.d — Normalize duplicate-claim across Prisma P2002, libsql
    // LibsqlError (code/rawCode), and message-pattern fallback. Before
    // O1.5.d this branch only matched P2002, so libsql's untranslated
    // SQLITE_CONSTRAINT_UNIQUE shape leaked through as `db_error` and
    // the dispatcher emitted an ERROR audit + exit 2. See
    // lib/runners/uniqueConstraintError.ts for the full detection table.
    if (isUniqueConstraintError(err)) {
      return { ok: false, reason: "already_held" };
    }
    return {
      ok: false,
      reason: "db_error",
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Extend the lease. Returns true if the lease is still owned by the caller
 * (token matches AND lease not preempted), false otherwise. The body uses
 * the return value to decide whether to abort.
 */
export async function heartbeatLease(leaseId: string, leaseToken: string, leaseSeconds: number): Promise<boolean> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseSeconds * 1000);
  // Conditional update — only proceeds if leaseToken still matches.
  const res = await prisma.runnerLease.updateMany({
    where: {
      id: leaseId,
      leaseToken,
      status: { in: ["claimed", "running"] },
    },
    data: {
      status: "running",
      lastHeartbeatAt: now,
      leaseExpiresAt: expiresAt,
    },
  });
  return res.count === 1;
}

export interface FinalizeLeaseInput {
  leaseId: string;
  leaseToken: string;
  status: Extract<RunnerLeaseState, "succeeded" | "failed">;
  durationMs: number;
  errorMessage?: string;
}

/** Mark the lease as finished. Idempotent on (leaseId, leaseToken). */
export async function finalizeLease(input: FinalizeLeaseInput): Promise<boolean> {
  const res = await prisma.runnerLease.updateMany({
    where: { id: input.leaseId, leaseToken: input.leaseToken },
    data: {
      status: input.status,
      finishedAt: new Date(),
      durationMs: input.durationMs,
      errorMessage: input.errorMessage ?? null,
    },
  });
  return res.count === 1;
}

/** Find leases whose holder appears to have died (lease expired, status
 *  not finalized). Returns rows the operator should review or that an
 *  external janitor could safely flag as "stale" so a new claim becomes
 *  possible. */
export async function findStaleLeases(opts: { now?: Date; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 50;
  return prisma.runnerLease.findMany({
    where: {
      status: { in: ["claimed", "running"] },
      leaseExpiresAt: { lt: now },
    },
    orderBy: { leaseExpiresAt: "asc" },
    take: limit,
  });
}

/** Mark a stale lease as such — frees the windowKey for future claims by
 *  flipping the status to a terminal state. Operator-driven. */
export async function markLeaseStale(leaseId: string, reason: string): Promise<boolean> {
  const res = await prisma.runnerLease.updateMany({
    where: { id: leaseId, status: { in: ["claimed", "running"] } },
    data: {
      status: "stale",
      finishedAt: new Date(),
      errorMessage: reason,
    },
  });
  return res.count === 1;
}

/** Return last N cycle results for a runner — operator dashboard fodder. */
export async function recentLeases(cycleName: string, limit = 25) {
  return prisma.runnerLease.findMany({
    where: { cycleName },
    orderBy: { leasedAt: "desc" },
    take: limit,
  });
}
