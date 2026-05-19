// ──────────────────────────────────────────────────────────────────────────────
//  lib/runners/windowKey.ts
//  Phase O1.4 — Window-key derivation for runner cycles.
//
//  Each (cycleName, windowGranularity, now) tuple deterministically maps to
//  a single windowKey string. The DB unique constraint on
//  RunnerLease.windowKey makes "this cycle already ran for this window"
//  observable atomically.
// ──────────────────────────────────────────────────────────────────────────────

import type { RunnerWindowGranularity } from "./types";

export interface WindowBounds {
  windowKey: string;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Derive (windowKey, windowStart, windowEnd) for a runner cycle.
 * Uses UTC throughout — operators in different time zones never disagree
 * about which window a cycle belongs to.
 */
export function deriveWindow(
  cycleName: string,
  granularity: RunnerWindowGranularity,
  now: Date = new Date(),
  override?: { windowKey?: string; windowStartOverride?: Date }
): WindowBounds {
  if (granularity === "manual") {
    if (!override?.windowKey) {
      throw new Error(`runner ${cycleName}: granularity=manual requires windowKey override`);
    }
    const start = override.windowStartOverride ?? now;
    return {
      windowKey: `${cycleName}_${override.windowKey}`,
      windowStart: start,
      windowEnd: start,
    };
  }

  if (override?.windowKey) {
    const start = override.windowStartOverride ?? now;
    return {
      windowKey: `${cycleName}_${override.windowKey}`,
      windowStart: start,
      windowEnd: start,
    };
  }

  const base = override?.windowStartOverride ?? now;
  switch (granularity) {
    case "hourly": {
      const start = new Date(Date.UTC(
        base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(),
        base.getUTCHours(), 0, 0, 0
      ));
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      const ts = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}T${pad2(start.getUTCHours())}`;
      return { windowKey: `${cycleName}_${ts}`, windowStart: start, windowEnd: end };
    }
    case "daily": {
      const start = new Date(Date.UTC(
        base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0, 0
      ));
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      const ts = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
      return { windowKey: `${cycleName}_${ts}`, windowStart: start, windowEnd: end };
    }
    case "weekly": {
      // ISO week starts Monday.
      const day = base.getUTCDay();
      const diff = day === 0 ? -6 : 1 - day; // shift to Monday
      const monday = new Date(Date.UTC(
        base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + diff, 0, 0, 0, 0
      ));
      const end = new Date(monday.getTime() + 7 * 24 * 60 * 60 * 1000);
      const isoWeek = computeIsoWeek(monday);
      const ts = `${monday.getUTCFullYear()}-W${pad2(isoWeek)}`;
      return { windowKey: `${cycleName}_${ts}`, windowStart: monday, windowEnd: end };
    }
    case "monthly": {
      const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1, 0, 0, 0, 0));
      const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 1, 0, 0, 0, 0));
      const ts = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}`;
      return { windowKey: `${cycleName}_${ts}`, windowStart: start, windowEnd: end };
    }
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function computeIsoWeek(dateUtc: Date): number {
  const d = new Date(Date.UTC(dateUtc.getUTCFullYear(), dateUtc.getUTCMonth(), dateUtc.getUTCDate()));
  // ISO 8601 week algorithm.
  const dayOfWeek = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayOfWeek + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(
    ((d.getTime() - firstThursday.getTime()) / (24 * 60 * 60 * 1000) - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
}
