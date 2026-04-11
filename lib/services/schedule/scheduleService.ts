// Module H4 — Schedule Seed service layer
//
// Handles:
//   - Seeding activities from the bid's trade list (one per BidTrade, in
//     canonical CSI order, with duration defaults + FS predecessor chain)
//   - Loading activities + project summary
//   - Updating a single activity
//   - Deleting an activity
//   - Recalculating start/finish dates from the chain
//
// v1 assumptions (from the planning conversation):
//   - One CONSTRUCTION activity per BidTrade (procurement is on the Subs tab)
//   - Canonical CSI sequence as seed; estimator can reorder
//   - FS predecessors only, chained sequentially
//   - Durations default by division, overridable per-activity
//   - Two milestones: "Construction Start" (seq 0) + "Substantial Completion"
//     (seq MAX)

import { prisma } from "@/lib/prisma";
import {
  defaultDurationFor,
  compareByDivisionOrder,
} from "./durationDefaults";

// ── Types ───────────────────────────────────────────────────────────────────

export const ACTIVITY_KINDS = ["CONSTRUCTION", "MILESTONE"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export function isValidActivityKind(k: string): k is ActivityKind {
  return (ACTIVITY_KINDS as readonly string[]).includes(k);
}

export type ScheduleActivityRow = {
  id: number;
  bidId: number;
  bidTradeId: number | null;
  tradeName: string | null;
  tradeCsiCode: string | null;

  activityId: string;
  name: string;
  kind: ActivityKind;
  sequence: number;
  durationDays: number;
  startDate: string | null;
  finishDate: string | null;
  predecessorIds: string[];

  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScheduleProjectSummary = {
  bidId: number;
  constructionStartDate: string | null;
  projectDurationDays: number | null;
  computedStartDate: string | null;
  computedFinishDate: string | null;
  activityCount: number;
  constructionCount: number;
  milestoneCount: number;
};

export type SeedResult = {
  tradesScanned: number;
  activitiesCreated: number;
  activitiesSkipped: number;
  milestonesCreated: number;
};

// ── Working-day date math ──────────────────────────────────────────────────
//
// Mon-Fri only. Holidays are not modeled in v1 (the seed is a starter — the
// PM imports into P6/MSP where holidays are tracked).

function isWeekend(d: Date): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

function toMidnightUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addCalendarDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/**
 * Advance a date to the next working day if it lands on a weekend.
 */
function nextWorkingDay(d: Date): Date {
  let cur = toMidnightUTC(d);
  while (isWeekend(cur)) cur = addCalendarDays(cur, 1);
  return cur;
}

/**
 * Add N working days to a start date. `addWorkingDays(start, 0)` returns the
 * start unchanged (assuming it's already a working day).
 */
function addWorkingDays(start: Date, days: number): Date {
  let cur = nextWorkingDay(start);
  let added = 0;
  while (added < days) {
    cur = addCalendarDays(cur, 1);
    if (!isWeekend(cur)) added += 1;
  }
  return cur;
}

/**
 * Activity duration N means the activity takes N working days. If it starts
 * Monday (day 0) and duration is 5, finish is the following Friday (4 days
 * forward, not 5). So: finish = addWorkingDays(start, duration - 1).
 */
function computeFinish(start: Date, durationDays: number): Date {
  if (durationDays <= 1) return nextWorkingDay(start);
  return addWorkingDays(nextWorkingDay(start), durationDays - 1);
}

/**
 * Start of the next activity = 1 working day after the predecessor's finish.
 */
function nextStartAfter(finish: Date): Date {
  return addWorkingDays(finish, 1);
}

// ── Activity ID generator ──────────────────────────────────────────────────
//
// Primavera convention: A1010, A1020, A1030 (spacing of 10 for easy manual
// insertion). Milestones use M1000 / M9999.

function buildConstructionActivityId(index: number): string {
  return `A${1010 + index * 10}`;
}

// ── Seeder ──────────────────────────────────────────────────────────────────

/**
 * Creates one CONSTRUCTION activity per BidTrade plus two milestones
 * (Construction Start / Substantial Completion). Idempotent — will not
 * duplicate existing activities (dedup by bidTradeId for construction,
 * by activityId for milestones).
 */
export async function seedScheduleActivities(bidId: number): Promise<SeedResult> {
  const result: SeedResult = {
    tradesScanned: 0,
    activitiesCreated: 0,
    activitiesSkipped: 0,
    milestonesCreated: 0,
  };

  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    include: { trade: true },
  });

  result.tradesScanned = bidTrades.length;

  // Load existing activities so we can skip dupes
  const existing = await prisma.scheduleActivity.findMany({
    where: { bidId },
    select: { id: true, bidTradeId: true, kind: true, activityId: true },
  });
  const existingByTradeId = new Set(
    existing.filter((e) => e.bidTradeId != null).map((e) => e.bidTradeId as number)
  );
  const existingMilestoneIds = new Set(
    existing.filter((e) => e.kind === "MILESTONE").map((e) => e.activityId)
  );

  // Sort trades into canonical construction order
  const ordered = [...bidTrades].sort((a, b) =>
    compareByDivisionOrder(a.trade.csiCode, b.trade.csiCode)
  );

  // Start milestone: always sequence 0
  if (!existingMilestoneIds.has("M1000")) {
    await prisma.scheduleActivity.create({
      data: {
        bidId,
        bidTradeId: null,
        activityId: "M1000",
        name: "Construction Start",
        kind: "MILESTONE",
        sequence: 0,
        durationDays: 0,
        predecessorIds: null,
      },
    });
    result.milestonesCreated += 1;
  }

  // Construction activities
  let seq = 10;
  let prevActivityId: string | null = "M1000";
  let createdInRun = 0;

  for (let i = 0; i < ordered.length; i++) {
    const bt = ordered[i];
    if (existingByTradeId.has(bt.id)) {
      result.activitiesSkipped += 1;
      // Still advance the sequence counter so new activities slot after
      // the existing ones — but we don't know their positions. We'll let
      // recalculateSchedule clean it up on the next call.
      continue;
    }

    const activityId = buildConstructionActivityId(createdInRun);
    const duration = defaultDurationFor(bt.trade.csiCode);

    await prisma.scheduleActivity.create({
      data: {
        bidId,
        bidTradeId: bt.id,
        activityId,
        name: bt.trade.name,
        kind: "CONSTRUCTION",
        sequence: seq,
        durationDays: duration,
        predecessorIds: prevActivityId,
      },
    });

    prevActivityId = activityId;
    seq += 10;
    createdInRun += 1;
    result.activitiesCreated += 1;
  }

  // Finish milestone: always highest sequence
  if (!existingMilestoneIds.has("M9999")) {
    await prisma.scheduleActivity.create({
      data: {
        bidId,
        bidTradeId: null,
        activityId: "M9999",
        name: "Substantial Completion",
        kind: "MILESTONE",
        sequence: 99999,
        durationDays: 0,
        predecessorIds: prevActivityId,
      },
    });
    result.milestonesCreated += 1;
  }

  // After seeding, immediately recalculate dates from the construction
  // start date (if set). This hydrates startDate/finishDate on every row.
  await recalculateSchedule(bidId);

  return result;
}

// ── Recalculator ────────────────────────────────────────────────────────────

/**
 * Walks all activities in sequence order and recomputes start/finish dates
 * based on duration + predecessor chain. Only works if bid.constructionStartDate
 * is set. When unset, clears all startDate/finishDate values.
 *
 * Predecessor resolution: finds the latest finishDate across all listed
 * predecessors. If no predecessors, uses the bid's construction start date.
 *
 * Also updates Bid.projectDurationDays with the total span (in working days).
 */
export async function recalculateSchedule(bidId: number): Promise<{
  startDate: string | null;
  finishDate: string | null;
  durationDays: number | null;
}> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { constructionStartDate: true },
  });

  const activities = await prisma.scheduleActivity.findMany({
    where: { bidId },
    orderBy: [{ sequence: "asc" }, { id: "asc" }],
  });

  // Without a construction start date, clear dates and bail
  if (!bid?.constructionStartDate) {
    for (const a of activities) {
      if (a.startDate != null || a.finishDate != null) {
        await prisma.scheduleActivity.update({
          where: { id: a.id },
          data: { startDate: null, finishDate: null },
        });
      }
    }
    await prisma.bid.update({ where: { id: bidId }, data: { projectDurationDays: null } });
    return { startDate: null, finishDate: null, durationDays: null };
  }

  const anchor = nextWorkingDay(new Date(bid.constructionStartDate));

  // Map of activityId → computed finish, for predecessor lookups
  const finishByActivityId = new Map<string, Date>();
  let projectStart: Date | null = null;
  let projectFinish: Date | null = null;

  for (const a of activities) {
    const predIds = (a.predecessorIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    let start: Date;
    if (predIds.length === 0) {
      start = anchor;
    } else {
      // Latest finish among predecessors. If any are missing (stale chain),
      // fall back to the anchor.
      let latest: Date | null = null;
      for (const pid of predIds) {
        const pf = finishByActivityId.get(pid);
        if (pf && (!latest || pf.getTime() > latest.getTime())) latest = pf;
      }
      start = latest ? nextStartAfter(latest) : anchor;
    }

    // Milestones have zero duration — finish == start
    const finish =
      a.kind === "MILESTONE" || a.durationDays <= 0
        ? nextWorkingDay(start)
        : computeFinish(start, a.durationDays);

    finishByActivityId.set(a.activityId, finish);
    if (!projectStart || start.getTime() < projectStart.getTime()) projectStart = start;
    if (!projectFinish || finish.getTime() > projectFinish.getTime()) projectFinish = finish;

    // Only write if dates actually changed (avoid churn)
    const currentStart = a.startDate ? a.startDate.getTime() : null;
    const currentFinish = a.finishDate ? a.finishDate.getTime() : null;
    if (currentStart !== start.getTime() || currentFinish !== finish.getTime()) {
      await prisma.scheduleActivity.update({
        where: { id: a.id },
        data: { startDate: start, finishDate: finish },
      });
    }
  }

  // Compute total project duration in working days
  let durationDays: number | null = null;
  if (projectStart && projectFinish) {
    durationDays = 0;
    let cur = new Date(projectStart);
    while (cur.getTime() <= projectFinish.getTime()) {
      if (!isWeekend(cur)) durationDays += 1;
      cur = addCalendarDays(cur, 1);
    }
  }

  await prisma.bid.update({
    where: { id: bidId },
    data: { projectDurationDays: durationDays },
  });

  return {
    startDate: projectStart?.toISOString() ?? null,
    finishDate: projectFinish?.toISOString() ?? null,
    durationDays,
  };
}

// ── Loaders ─────────────────────────────────────────────────────────────────

export async function loadScheduleForBid(bidId: number): Promise<{
  activities: ScheduleActivityRow[];
  summary: ScheduleProjectSummary;
}> {
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: { constructionStartDate: true, projectDurationDays: true },
  });

  const items = await prisma.scheduleActivity.findMany({
    where: { bidId },
    include: {
      bidTrade: { include: { trade: true } },
    },
    orderBy: [{ sequence: "asc" }, { id: "asc" }],
  });

  const activities: ScheduleActivityRow[] = items.map((it) => ({
    id: it.id,
    bidId: it.bidId,
    bidTradeId: it.bidTradeId,
    tradeName: it.bidTrade?.trade.name ?? null,
    tradeCsiCode: it.bidTrade?.trade.csiCode ?? null,
    activityId: it.activityId,
    name: it.name,
    kind: (isValidActivityKind(it.kind) ? it.kind : "CONSTRUCTION") as ActivityKind,
    sequence: it.sequence,
    durationDays: it.durationDays,
    startDate: it.startDate?.toISOString() ?? null,
    finishDate: it.finishDate?.toISOString() ?? null,
    predecessorIds: (it.predecessorIds ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    notes: it.notes,
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  }));

  let computedStart: string | null = null;
  let computedFinish: string | null = null;
  for (const a of activities) {
    if (a.startDate && (!computedStart || a.startDate < computedStart)) computedStart = a.startDate;
    if (a.finishDate && (!computedFinish || a.finishDate > computedFinish)) computedFinish = a.finishDate;
  }

  const summary: ScheduleProjectSummary = {
    bidId,
    constructionStartDate: bid?.constructionStartDate?.toISOString() ?? null,
    projectDurationDays: bid?.projectDurationDays ?? null,
    computedStartDate: computedStart,
    computedFinishDate: computedFinish,
    activityCount: activities.length,
    constructionCount: activities.filter((a) => a.kind === "CONSTRUCTION").length,
    milestoneCount: activities.filter((a) => a.kind === "MILESTONE").length,
  };

  return { activities, summary };
}

// ── Update / Delete ─────────────────────────────────────────────────────────

export type ActivityUpdateInput = {
  name?: string;
  durationDays?: number;
  sequence?: number;
  predecessorIds?: string | null;
  notes?: string | null;
  kind?: string;
};

export type MutationResult = { ok: true } | { ok: false; error: string };

export async function updateScheduleActivity(
  bidId: number,
  activityRowId: number,
  input: ActivityUpdateInput
): Promise<MutationResult> {
  const existing = await prisma.scheduleActivity.findUnique({
    where: { id: activityRowId },
    select: { id: true, bidId: true },
  });
  if (!existing) return { ok: false, error: "Activity not found" };
  if (existing.bidId !== bidId)
    return { ok: false, error: "Activity does not belong to this bid" };

  if (input.kind !== undefined && !isValidActivityKind(input.kind)) {
    return { ok: false, error: `Invalid kind. Must be one of: ${ACTIVITY_KINDS.join(", ")}` };
  }

  if (input.durationDays !== undefined) {
    if (typeof input.durationDays !== "number" || !Number.isFinite(input.durationDays)) {
      return { ok: false, error: "durationDays must be a number" };
    }
    if (input.durationDays < 0 || input.durationDays > 10000) {
      return { ok: false, error: "durationDays must be between 0 and 10000" };
    }
  }

  if (input.sequence !== undefined) {
    if (typeof input.sequence !== "number" || !Number.isFinite(input.sequence)) {
      return { ok: false, error: "sequence must be a number" };
    }
  }

  const data: Record<string, unknown> = {};
  if ("name" in input && input.name != null) data.name = input.name.slice(0, 200);
  if ("durationDays" in input && input.durationDays != null)
    data.durationDays = Math.round(input.durationDays);
  if ("sequence" in input && input.sequence != null)
    data.sequence = Math.round(input.sequence);
  if ("predecessorIds" in input) data.predecessorIds = input.predecessorIds ?? null;
  if ("notes" in input) data.notes = input.notes ?? null;
  if ("kind" in input && input.kind) data.kind = input.kind;

  await prisma.scheduleActivity.update({
    where: { id: activityRowId },
    data,
  });

  // Any change to duration/sequence/predecessor requires dates to be recomputed
  if (
    "durationDays" in input ||
    "sequence" in input ||
    "predecessorIds" in input
  ) {
    await recalculateSchedule(bidId);
  }

  return { ok: true };
}

export async function deleteScheduleActivity(
  bidId: number,
  activityRowId: number
): Promise<MutationResult> {
  const existing = await prisma.scheduleActivity.findUnique({
    where: { id: activityRowId },
    select: { id: true, bidId: true },
  });
  if (!existing) return { ok: false, error: "Activity not found" };
  if (existing.bidId !== bidId)
    return { ok: false, error: "Activity does not belong to this bid" };

  await prisma.scheduleActivity.delete({ where: { id: activityRowId } });
  await recalculateSchedule(bidId);
  return { ok: true };
}

// ── Manual add ──────────────────────────────────────────────────────────────

export type ActivityCreateInput = {
  name: string;
  kind?: string;
  durationDays?: number;
  sequence?: number;
  predecessorIds?: string | null;
  notes?: string | null;
};

export async function createScheduleActivity(
  bidId: number,
  input: ActivityCreateInput
): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (!input.name || input.name.trim().length < 2) {
    return { ok: false, error: "name is required" };
  }
  if (input.kind !== undefined && !isValidActivityKind(input.kind)) {
    return { ok: false, error: `Invalid kind. Must be one of: ${ACTIVITY_KINDS.join(", ")}` };
  }

  // Next sequence: one greater than current max (below milestones)
  const maxSeq = await prisma.scheduleActivity.aggregate({
    where: { bidId, kind: "CONSTRUCTION" },
    _max: { sequence: true },
  });
  const nextSeq = (maxSeq._max.sequence ?? 0) + 10;

  // Next activityId: highest "Axxxx" + 10
  const maxIdRow = await prisma.scheduleActivity.findFirst({
    where: { bidId, activityId: { startsWith: "A" } },
    orderBy: { activityId: "desc" },
    select: { activityId: true },
  });
  let nextIdNum = 1010;
  if (maxIdRow?.activityId) {
    const n = parseInt(maxIdRow.activityId.slice(1), 10);
    if (Number.isFinite(n)) nextIdNum = n + 10;
  }
  const nextActivityId = `A${nextIdNum}`;

  const created = await prisma.scheduleActivity.create({
    data: {
      bidId,
      activityId: nextActivityId,
      name: input.name.trim().slice(0, 200),
      kind: input.kind ?? "CONSTRUCTION",
      sequence: input.sequence ?? nextSeq,
      durationDays: Math.round(input.durationDays ?? 5),
      predecessorIds: input.predecessorIds ?? null,
      notes: input.notes ?? null,
    },
  });

  await recalculateSchedule(bidId);
  return { ok: true, id: created.id };
}
