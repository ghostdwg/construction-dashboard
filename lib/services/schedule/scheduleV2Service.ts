// Phase 5C — Schedule V2 service layer
//
// Handles CRUD for Schedule / ScheduleActivityV2 / ScheduleDependency /
// ScheduleVersion. The old ScheduleActivity (H4) is untouched.
//
// Forward-pass scheduler: computes startDate / finishDate per activity using
// working-day math (Mon–Fri) and the ScheduleDependency table.
// All four CPM dependency types (FS/SS/FF/SF) with positive and negative lag
// are fully supported. Summary rows inherit min(start)/max(finish) of children.

import { prisma } from "@/lib/prisma";
import {
  csiDivision,
  LONG_LEAD_PROCUREMENT,
} from "./durationDefaults";

// ── Exported types ────────────────────────────────────────────────────────────

export type ActivityV2 = {
  id: string;
  scheduleId: string;
  activityCode: string;
  wbsId: string;
  outlineLevel: number;
  sortOrder: number;
  name: string;
  duration: number;
  isSummary: boolean;
  isMilestone: boolean;
  csiCode: string | null;
  trade: string | null;
  weatherCode: string;
  requiresInspection: boolean;
  notes: string;
  aiGenerated: boolean;
  status: string;
  percentComplete: number;
  actualStart: string | null;
  actualFinish: string | null;
  remainingDuration: number | null;
  delayReason: string | null;
  startDate: string | null;
  finishDate: string | null;
};

export type DepRow = {
  id: string;
  predecessorId: string;
  successorId: string;
  type: string; // FS | SS | FF | SF
  lag: number;
};

export type ScheduleV2 = {
  id: string;
  bidId: number;
  name: string;
  startDate: string;
  isBaseline: boolean;
  weatherMode: string;
  weatherStation: string | null;
  activeLayers: string[];
};

export type LoadResult = {
  schedule: ScheduleV2;
  activities: ActivityV2[];
  deps: DepRow[];
};

export type SeedResultV2 = {
  tradesScanned: number;
  activitiesCreated: number;
  activitiesSkipped: number;
};

// ── Working-day math ──────────────────────────────────────────────────────────

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

// Advance by |days| working days, forward (days>0) or backward (days<0).
export function addWorkingDays(start: Date, days: number): Date {
  if (days === 0) return new Date(start);
  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);
  const d = new Date(start);
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + step);
    if (!isWeekend(d)) remaining--;
  }
  return d;
}

function nextWorkingDay(d: Date): Date {
  return addWorkingDays(d, 1);
}

// finish = start + (duration - 1) working days (activity occupies `duration` days)
function computeFinish(start: Date, durationDays: number): Date {
  if (durationDays <= 1) return new Date(start);
  return addWorkingDays(start, durationDays - 1);
}

// ── CPM dependency helper ─────────────────────────────────────────────────────
//
// Returns the earliest allowable start for a successor given one predecessor
// constraint. All four CPM relationship types are handled.
//
//  FS+lag  — successor starts the next working day after (predFinish + lag)
//  SS+lag  — successor starts at predStart + lag working days
//  FF+lag  — successor must finish ≥ predFinish + lag → back-compute start
//  SF+lag  — successor must finish ≥ predStart  + lag → back-compute start

function earliestStartFromDep(
  dep: { type: string; lag: number },
  predStart: Date,
  predFinish: Date,
  successorDuration: number
): Date {
  const lag = dep.lag;
  switch (dep.type) {
    case "SS":
      return addWorkingDays(predStart, lag);
    case "FF": {
      const minFinish = addWorkingDays(predFinish, lag);
      return successorDuration <= 1
        ? minFinish
        : addWorkingDays(minFinish, -(successorDuration - 1));
    }
    case "SF": {
      const minFinish = addWorkingDays(predStart, lag);
      return successorDuration <= 1
        ? minFinish
        : addWorkingDays(minFinish, -(successorDuration - 1));
    }
    case "FS":
    default:
      return nextWorkingDay(addWorkingDays(predFinish, lag));
  }
}

// ── Loaders ───────────────────────────────────────────────────────────────────

function mapActivity(a: {
  id: string; scheduleId: string; activityCode: string; wbsId: string;
  outlineLevel: number; sortOrder: number; name: string; duration: number;
  isSummary: boolean; isMilestone: boolean; csiCode: string | null;
  trade: string | null; weatherCode: string; requiresInspection: boolean;
  notes: string; aiGenerated: boolean; status: string;
  percentComplete: number; actualStart: Date | null; actualFinish: Date | null;
  remainingDuration: number | null; delayReason: string | null;
  startDate: Date | null; finishDate: Date | null;
}): ActivityV2 {
  return {
    id: a.id,
    scheduleId: a.scheduleId,
    activityCode: a.activityCode,
    wbsId: a.wbsId,
    outlineLevel: a.outlineLevel,
    sortOrder: a.sortOrder,
    name: a.name,
    duration: a.duration,
    isSummary: a.isSummary,
    isMilestone: a.isMilestone,
    csiCode: a.csiCode,
    trade: a.trade,
    weatherCode: a.weatherCode,
    requiresInspection: a.requiresInspection,
    notes: a.notes,
    aiGenerated: a.aiGenerated,
    status: a.status,
    percentComplete: a.percentComplete,
    actualStart: a.actualStart?.toISOString() ?? null,
    actualFinish: a.actualFinish?.toISOString() ?? null,
    remainingDuration: a.remainingDuration,
    delayReason: a.delayReason,
    startDate: a.startDate?.toISOString() ?? null,
    finishDate: a.finishDate?.toISOString() ?? null,
  };
}

export async function getScheduleForBid(bidId: number): Promise<LoadResult | null> {
  const schedule = await prisma.schedule.findFirst({
    where: { bidId },
    orderBy: { createdAt: "asc" },
  });
  if (!schedule) return null;
  return loadScheduleById(schedule.id);
}

export async function loadScheduleById(scheduleId: string): Promise<LoadResult> {
  const [schedule, activities, deps] = await Promise.all([
    prisma.schedule.findUniqueOrThrow({ where: { id: scheduleId } }),
    prisma.scheduleActivityV2.findMany({
      where: { scheduleId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.scheduleDependency.findMany({
      where: {
        predecessor: { scheduleId },
      },
    }),
  ]);

  let parsedLayers: string[] = [];
  try { parsedLayers = JSON.parse(schedule.activeLayers); } catch { /* */ }

  return {
    schedule: {
      id: schedule.id,
      bidId: schedule.bidId,
      name: schedule.name,
      startDate: schedule.startDate.toISOString(),
      isBaseline: schedule.isBaseline,
      weatherMode: schedule.weatherMode,
      weatherStation: schedule.weatherStation,
      activeLayers: parsedLayers,
    },
    activities: activities.map(mapActivity),
    deps: deps.map((d) => ({
      id: d.id,
      predecessorId: d.predecessorId,
      successorId: d.successorId,
      type: d.type,
      lag: d.lag,
    })),
  };
}

// ── Schedule create ───────────────────────────────────────────────────────────

export async function createSchedule(
  bidId: number,
  startDate: Date,
  name = "Baseline Schedule"
): Promise<string> {
  const s = await prisma.schedule.create({
    data: { bidId, name, startDate },
  });
  return s.id;
}

export async function getOrCreateSchedule(bidId: number): Promise<string> {
  const existing = await prisma.schedule.findFirst({
    where: { bidId },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing.id;

  // Use bid's constructionStartDate if set, else default to next Monday
  const bid = await prisma.bid.findUniqueOrThrow({
    where: { id: bidId },
    select: { constructionStartDate: true },
  });
  const startDate = bid.constructionStartDate ?? nextMonday();
  const s = await prisma.schedule.create({
    data: { bidId, name: "Baseline Schedule", startDate },
  });
  return s.id;
}

function nextMonday(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay(); // 0=Sun, 1=Mon...
  const daysUntilMonday = dow === 0 ? 1 : dow === 1 ? 7 : 8 - dow;
  d.setUTCDate(d.getUTCDate() + daysUntilMonday);
  return d;
}

// ── Recalculator ──────────────────────────────────────────────────────────────
//
// Topological forward pass. Summary rows (isSummary) are skipped for date
// calculation — they will inherit min(start) / max(finish) of children in a
// future rollup pass.
//
// Only FS dependency type is computed in Phase 1. lag is applied in working days.

export async function recalculateScheduleV2(scheduleId: string): Promise<ActivityV2[]> {
  const schedule = await prisma.schedule.findUniqueOrThrow({
    where: { id: scheduleId },
    select: { startDate: true },
  });

  const [allActivities, allDeps] = await Promise.all([
    prisma.scheduleActivityV2.findMany({
      where: { scheduleId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.scheduleDependency.findMany({
      where: { predecessor: { scheduleId } },
    }),
  ]);

  if (allActivities.length === 0) return [];

  const taskActivities = allActivities.filter((a) => !a.isSummary);
  const taskDeps = allDeps.filter((d) =>
    taskActivities.some((a) => a.id === d.successorId) &&
    taskActivities.some((a) => a.id === d.predecessorId)
  );

  // Topological sort (Kahn's)
  const predMap = new Map<string, string[]>(); // id -> predecessor ids
  for (const a of taskActivities) predMap.set(a.id, []);
  for (const d of taskDeps) predMap.get(d.successorId)?.push(d.predecessorId);

  const inDeg = new Map<string, number>();
  for (const a of taskActivities) inDeg.set(a.id, (predMap.get(a.id) ?? []).length);

  const queue = taskActivities.filter((a) => inDeg.get(a.id) === 0);
  const sorted: typeof taskActivities = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);
    for (const d of taskDeps) {
      if (d.predecessorId === node.id) {
        const newDeg = (inDeg.get(d.successorId) ?? 1) - 1;
        inDeg.set(d.successorId, newDeg);
        if (newDeg === 0) {
          const succ = taskActivities.find((a) => a.id === d.successorId);
          if (succ) queue.push(succ);
        }
      }
    }
  }

  // Any unvisited nodes (cycle detection — push to end)
  for (const a of taskActivities) {
    if (!sorted.includes(a)) sorted.push(a);
  }

  // Forward pass — tracks both startMap and finishMap for SS/FF/SF support
  const startMap = new Map<string, Date>();
  const finishMap = new Map<string, Date>();
  const updates: Array<{ id: string; startDate: Date; finishDate: Date }> = [];

  for (const activity of sorted) {
    const preds = taskDeps.filter((d) => d.successorId === activity.id);
    let earliestStart: Date;

    if (preds.length === 0) {
      earliestStart = new Date(schedule.startDate);
    } else {
      let maxStart = new Date(0);
      for (const dep of preds) {
        const pStart = startMap.get(dep.predecessorId);
        const pFinish = finishMap.get(dep.predecessorId);
        if (!pStart || !pFinish) continue;
        const es = earliestStartFromDep(dep, pStart, pFinish, activity.duration);
        if (es > maxStart) maxStart = es;
      }
      earliestStart = maxStart.getTime() === 0 ? new Date(schedule.startDate) : maxStart;
    }

    // Ensure start lands on a working day
    while (isWeekend(earliestStart)) earliestStart = nextWorkingDay(earliestStart);

    const finish = activity.isMilestone
      ? new Date(earliestStart)
      : computeFinish(earliestStart, activity.duration);
    startMap.set(activity.id, earliestStart);
    finishMap.set(activity.id, finish);
    updates.push({ id: activity.id, startDate: earliestStart, finishDate: finish });
  }

  // Batch write updates
  await Promise.all(
    updates.map(({ id, startDate, finishDate }) =>
      prisma.scheduleActivityV2.update({
        where: { id },
        data: { startDate, finishDate },
      })
    )
  );

  // Return full updated list in sortOrder
  const refreshed = await prisma.scheduleActivityV2.findMany({
    where: { scheduleId },
    orderBy: { sortOrder: "asc" },
  });

  // Recalculate schedule-tied submittal due dates for any submittals linked to
  // activities in this schedule. Runs after startDates are committed above.
  await recalcSubmittalsForSchedule(scheduleId);

  return refreshed.map(mapActivity);
}

// Recalculate requiredOnSiteDate + submitByDate for all SubmittalItems that are
// linked to activities belonging to this schedule.
async function recalcSubmittalsForSchedule(scheduleId: string): Promise<void> {
  const sched = await prisma.schedule.findUnique({
    where: { id: scheduleId },
    select: { bidId: true },
  });
  if (!sched) return;

  const submittals = await prisma.submittalItem.findMany({
    where: { bidId: sched.bidId, linkedActivityId: { not: null } },
    select: {
      id: true,
      linkedActivityId: true,
      leadTimeDays: true,
      reviewBufferDays: true,
      resubmitBufferDays: true,
      linkedActivity: { select: { startDate: true, scheduleId: true } },
    },
  });

  // Only touch submittals whose linked activity belongs to this schedule
  const relevant = submittals.filter(
    (s) => s.linkedActivity?.scheduleId === scheduleId && s.linkedActivity.startDate != null
  );

  await Promise.all(
    relevant.map((s) => {
      const startDate = s.linkedActivity!.startDate!;
      const requiredOnSiteDate = addWorkingDays(startDate, -s.leadTimeDays);
      const submitByDate = addWorkingDays(
        requiredOnSiteDate,
        -(s.reviewBufferDays + s.resubmitBufferDays)
      );
      return prisma.submittalItem.update({
        where: { id: s.id },
        data: { requiredOnSiteDate, submitByDate },
      });
    })
  );
}

// ── GC Schedule Template ──────────────────────────────────────────────────────
//
// 9-phase commercial ground-up shell + TI CPM template.
// Matches industry-standard scheduling practice for GC submittals under
// contract scheduling specs (AIA A201 §3.10, CSI 01 32 16, CMAA standards).
//
// Dependency types: FS (majority), SS+lag (interior rough-in overlaps),
// FF (ceiling tile after electrical), and FS with negative lag (lead time).
// Inspection milestones auto-inserted at footing, foundation, under-slab,
// in-wall, and final inspection hold points.
//
// BidTrades are absorbed: long-lead trades populate Phase 2 as procurement
// activities; all trades update the `trade` field on the matching template
// activity for their CSI division.

type TemplateDep = { code: string; type?: string; lag?: number };
type TemplateRow = {
  code: string;
  name: string;
  dur: number;
  lvl: 1 | 2;
  milestone?: boolean;
  summary?: boolean;
  inspection?: boolean;
  weather?: string;
  csiDiv?: string;
  trade?: string;
  notes?: string;
  deps?: TemplateDep[];
};

const GC_TEMPLATE: TemplateRow[] = [
  // 1.0 Preconstruction
  { code:"P1000", name:"1.0 Preconstruction",            dur:0,  lvl:1, summary:true },
  { code:"M1000", name:"Notice to Proceed",               dur:0,  lvl:2, milestone:true },
  { code:"P1010", name:"Contract Execution",              dur:5,  lvl:2, deps:[{code:"M1000"}] },
  { code:"P1020", name:"Permit / AHJ Review",             dur:20, lvl:2, deps:[{code:"P1010"}] },
  { code:"P1030", name:"Submittal Register Setup",        dur:5,  lvl:2, deps:[{code:"P1010"}] },
  { code:"P1040", name:"Baseline Schedule Development",   dur:5,  lvl:2, deps:[{code:"P1010"}] },
  { code:"P1050", name:"Long Lead Procurement Kickoff",   dur:3,  lvl:2, deps:[{code:"P1030"}] },

  // 2.0 Procurement & Long Lead  (trade activities inserted dynamically)
  { code:"P2000", name:"2.0 Procurement & Long Lead",    dur:0,  lvl:1, summary:true },

  // 3.0 Mobilization & Site Work
  { code:"P3000", name:"3.0 Mobilization & Site Work",   dur:0,  lvl:1, summary:true },
  { code:"P3010", name:"Mobilization",                    dur:3,  lvl:2, deps:[{code:"P1050"},{code:"P1020"}] },
  { code:"P3020", name:"Layout / Survey Control",         dur:2,  lvl:2, deps:[{code:"P3010"}] },
  { code:"P3030", name:"Erosion Control / SWPPP Install", dur:2,  lvl:2, deps:[{code:"P3010"}] },
  { code:"P3040", name:"Clearing / Strip Topsoil",        dur:4,  lvl:2, deps:[{code:"P3020"}] },
  { code:"P3050", name:"Building Pad Excavation",         dur:5,  lvl:2, deps:[{code:"P3040"}], csiDiv:"31" },
  { code:"P3060", name:"Underground Utilities",           dur:8,  lvl:2, deps:[{code:"P3050",lag:-2}], csiDiv:"33", notes:"Slight overlap where practical" },
  { code:"P3070", name:"Footing Excavation",              dur:3,  lvl:2, deps:[{code:"P3050"}], csiDiv:"31" },
  { code:"P3080", name:"Footing Form / Reinforce",        dur:4,  lvl:2, deps:[{code:"P3070"}], csiDiv:"03" },
  { code:"M3085", name:"Footing Inspection",              dur:0,  lvl:2, milestone:true, inspection:true, deps:[{code:"P3080"}] },
  { code:"P3090", name:"Footing Concrete Placement",      dur:2,  lvl:2, deps:[{code:"M3085"}], csiDiv:"03" },
  { code:"P3100", name:"Foundation Wall Form / Reinforce",dur:5,  lvl:2, deps:[{code:"P3090"}], csiDiv:"03" },
  { code:"M3105", name:"Foundation Wall Inspection",      dur:0,  lvl:2, milestone:true, inspection:true, deps:[{code:"P3100"}] },
  { code:"P3110", name:"Foundation Wall Concrete",        dur:2,  lvl:2, deps:[{code:"M3105"}], csiDiv:"03" },
  { code:"P3120", name:"Damp Proofing / Waterproofing",   dur:3,  lvl:2, deps:[{code:"P3110"}], csiDiv:"07" },
  { code:"P3130", name:"Backfill Foundations",            dur:4,  lvl:2, deps:[{code:"P3120"}] },
  { code:"P3140", name:"Under Slab Prep / Stone / Vapor Barrier", dur:4, lvl:2, deps:[{code:"P3130"},{code:"P3060"}] },
  { code:"P3150", name:"Under Slab MEP Rough-In",         dur:4,  lvl:2, deps:[{code:"P3140"}], csiDiv:"22", trade:"MEP" },
  { code:"M3155", name:"Under Slab Inspection",           dur:0,  lvl:2, milestone:true, inspection:true, deps:[{code:"P3150"}] },
  { code:"P3160", name:"Slab Reinforcement / Prep",       dur:3,  lvl:2, deps:[{code:"M3155"}], csiDiv:"03" },
  { code:"P3170", name:"Slab Placement",                  dur:2,  lvl:2, deps:[{code:"P3160"}], csiDiv:"03" },
  { code:"P3180", name:"Slab Cure / Protection",          dur:5,  lvl:2, deps:[{code:"P3170"}], csiDiv:"03" },

  // 4.0 Structure
  { code:"P4000", name:"4.0 Structure",                   dur:0,  lvl:1, summary:true },
  { code:"P4010", name:"Structural Delivery",             dur:2,  lvl:2, deps:[{code:"P3180"}], csiDiv:"05", notes:"Requires slab/foundation readiness" },
  { code:"P4020", name:"Structural Erection",             dur:10, lvl:2, deps:[{code:"P4010"}], csiDiv:"05" },
  { code:"P4030", name:"Anchor / Alignment Verification", dur:1,  lvl:2, deps:[{code:"P4020",type:"SS",lag:2}], notes:"QC during erection" },
  { code:"M4040", name:"Roof Structure Completion",       dur:0,  lvl:2, milestone:true, deps:[{code:"P4020"}] },

  // 5.0 Building Envelope
  { code:"P5000", name:"5.0 Building Envelope",          dur:0,  lvl:1, summary:true },
  { code:"P5010", name:"Roof Panels Install",             dur:6,  lvl:2, deps:[{code:"M4040"}], csiDiv:"07" },
  { code:"P5020", name:"Wall Panels Install",             dur:8,  lvl:2, deps:[{code:"P4020",type:"SS",lag:4}], csiDiv:"07", notes:"Overlap during erection" },
  { code:"M5030", name:"Weather Tight",                   dur:0,  lvl:2, milestone:true, deps:[{code:"P5010"},{code:"P5020"}] },
  { code:"P5040", name:"Storefront Installation",         dur:5,  lvl:2, deps:[{code:"M5030"}], csiDiv:"08" },
  { code:"P5050", name:"Overhead Door Installation",      dur:4,  lvl:2, deps:[{code:"M5030"}], csiDiv:"08" },
  { code:"P5060", name:"Sealants / Exterior Closure",     dur:4,  lvl:2, deps:[{code:"P5040"},{code:"P5050"}], csiDiv:"07" },

  // 6.0 Interior Framing & Rough-In  (SS+lag overlaps mirror sample IDs 56–61)
  { code:"P6000", name:"6.0 Interior Framing & Rough-In",dur:0,  lvl:1, summary:true },
  { code:"P6010", name:"Interior Layout",                 dur:2,  lvl:2, deps:[{code:"M5030"}] },
  { code:"P6020", name:"Interior Metal Stud Framing",     dur:8,  lvl:2, deps:[{code:"P6010"}], csiDiv:"06" },
  { code:"P6030", name:"In-Wall Blocking",                dur:3,  lvl:2, deps:[{code:"P6020",type:"SS",lag:2}], csiDiv:"06", notes:"Overlap with framing" },
  { code:"P6040", name:"Above Ceiling MEP Coordination",  dur:2,  lvl:2, deps:[{code:"P6010"}] },
  { code:"P6050", name:"Plumbing Rough-In",               dur:5,  lvl:2, deps:[{code:"P6020",type:"SS",lag:2}], csiDiv:"22" },
  { code:"P6060", name:"HVAC Rough-In",                   dur:6,  lvl:2, deps:[{code:"P6020",type:"SS",lag:2}], csiDiv:"23" },
  { code:"P6070", name:"Electrical Rough-In",             dur:6,  lvl:2, deps:[{code:"P6020",type:"SS",lag:2}], csiDiv:"26" },
  { code:"P6080", name:"Low Voltage Rough-In",            dur:4,  lvl:2, deps:[{code:"P6070",type:"SS",lag:1}], csiDiv:"27" },
  { code:"M6085", name:"In-Wall Inspection",              dur:0,  lvl:2, milestone:true, inspection:true,
    deps:[{code:"P6030"},{code:"P6050"},{code:"P6060"},{code:"P6070"},{code:"P6080"}] },
  { code:"P6090", name:"Insulation",                      dur:3,  lvl:2, deps:[{code:"M6085"}], csiDiv:"07" },
  { code:"P6100", name:"Drywall Hang",                    dur:5,  lvl:2, deps:[{code:"P6090"}], csiDiv:"09" },
  { code:"P6110", name:"Drywall Finish",                  dur:6,  lvl:2, deps:[{code:"P6100"}], csiDiv:"09" },

  // 7.0 Interior Finishes  (FS-1d lead + FF relationship from sample)
  { code:"P7000", name:"7.0 Interior Finishes",           dur:0,  lvl:1, summary:true },
  { code:"P7010", name:"Prime / First Coat Paint",        dur:4,  lvl:2, deps:[{code:"P6110",lag:-1}], csiDiv:"09", notes:"Slight overlap after finish progress" },
  { code:"P7020", name:"Ceiling Grid Install",            dur:4,  lvl:2, deps:[{code:"P6110"}] },
  { code:"P7030", name:"Ceiling Tile Install",            dur:3,  lvl:2, deps:[{code:"P7020"},{code:"P6070",type:"FF"}] },
  { code:"P7040", name:"Casework / Millwork Install",     dur:4,  lvl:2, deps:[{code:"P7010"}] },
  { code:"P7050", name:"Flooring Prep",                   dur:2,  lvl:2, deps:[{code:"P7010"}] },
  { code:"P7060", name:"Flooring Install",                dur:4,  lvl:2, deps:[{code:"P7050"}] },
  { code:"P7070", name:"Finish Electrical Devices",       dur:4,  lvl:2, deps:[{code:"P7030"},{code:"P7060"}], csiDiv:"26" },
  { code:"P7080", name:"Finish Plumbing Trim",            dur:3,  lvl:2, deps:[{code:"P7060"}], csiDiv:"22" },
  { code:"P7090", name:"HVAC Startup Prep",               dur:2,  lvl:2, deps:[{code:"P7030"}], csiDiv:"23" },
  { code:"P7100", name:"Bathroom Accessories / Specialties",dur:2, lvl:2, deps:[{code:"P7040"},{code:"P7080"}], csiDiv:"10" },
  { code:"P7110", name:"Final Paint / Touchup",           dur:3,  lvl:2, deps:[{code:"P7070"},{code:"P7080"},{code:"P7100"}], csiDiv:"09" },

  // 8.0 Exterior Site Improvements
  { code:"P8000", name:"8.0 Exterior Site Improvements",  dur:0,  lvl:1, summary:true },
  { code:"P8010", name:"Fine Grading",                    dur:4,  lvl:2, deps:[{code:"P3130"}], csiDiv:"31" },
  { code:"P8020", name:"Sidewalks / Exterior Flatwork",   dur:4,  lvl:2, deps:[{code:"P8010"}], csiDiv:"32", weather:"WS-2", notes:"Weather-sensitive" },
  { code:"P8030", name:"Pavement Prep",                   dur:3,  lvl:2, deps:[{code:"P8010"}], csiDiv:"32" },
  { code:"P8040", name:"Asphalt / Paving",                dur:3,  lvl:2, deps:[{code:"P8030"}], csiDiv:"32", weather:"WS-2", notes:"Weather-sensitive" },
  { code:"P8050", name:"Striping / Signage",              dur:2,  lvl:2, deps:[{code:"P8040"}] },
  { code:"P8060", name:"Landscaping",                     dur:3,  lvl:2, deps:[{code:"P8020"},{code:"P8040"}] },

  // 9.0 Startup, Inspections & Closeout
  { code:"P9000", name:"9.0 Startup, Inspections & Closeout", dur:0, lvl:1, summary:true },
  { code:"P9010", name:"HVAC Startup / TAB",              dur:4,  lvl:2, deps:[{code:"P7090"}], csiDiv:"23" },
  { code:"P9020", name:"Fire Alarm / Life Safety Testing",dur:2,  lvl:2, deps:[{code:"P7070"}], csiDiv:"28" },
  { code:"P9030", name:"Final MEP Inspections",           dur:2,  lvl:2, deps:[{code:"P7070"},{code:"P7080"},{code:"P9010"}], inspection:true },
  { code:"M9040", name:"Building Final Inspection",       dur:0,  lvl:2, milestone:true, inspection:true,
    deps:[{code:"P7110"},{code:"P8050"},{code:"P8060"},{code:"P9030"}] },
  { code:"P9050", name:"Punchlist",                       dur:5,  lvl:2, deps:[{code:"M9040"}] },
  { code:"P9060", name:"Punchlist Completion",            dur:4,  lvl:2, deps:[{code:"P9050"}] },
  { code:"M9070", name:"Substantial Completion",          dur:0,  lvl:2, milestone:true, deps:[{code:"P9060"}] },
  { code:"P9080", name:"Closeout Docs / O&M / Training",  dur:5,  lvl:2, deps:[{code:"M9070"}] },
  { code:"M9090", name:"Final Completion",                dur:0,  lvl:2, milestone:true, deps:[{code:"P9080"}] },
];

// Long-lead → field activity codes whose start depends on procurement finish.
// Multiple field codes: both storefront and overhead doors wait on div-08 proc.
const LONG_LEAD_FIELD: Record<string, string[]> = {
  "05": ["P4010"],
  "07": ["P5010"],
  "08": ["P5040", "P5050"],
  "23": ["P6060"],
  "26": ["P6070"],
};

// Primary template activity per CSI division for trade-name stamping.
const DIV_TRADE_CODE: Record<string, string> = {
  "03": "P3090", "04": "P3110", "05": "P4020", "06": "P6020",
  "07": "P5010", "08": "P5040", "09": "P6100", "10": "P7100",
  "22": "P6050", "23": "P6060", "26": "P6070", "27": "P6080",
  "28": "P9020", "31": "P3050", "32": "P8030", "33": "P3060",
};

// ── Seeder ────────────────────────────────────────────────────────────────────
//
// Creates the full 9-phase commercial GC template on first run, then maps
// BidTrades into Phase 2 (long-lead procurement) and updates trade names on
// matching template activities. Idempotent: skips template creation if P1000
// already exists.

export async function seedScheduleV2(bidId: number, force = false): Promise<SeedResultV2> {
  const result: SeedResultV2 = { tradesScanned: 0, activitiesCreated: 0, activitiesSkipped: 0 };
  const scheduleId = await getOrCreateSchedule(bidId);

  if (force) {
    // Wipe existing activities and their dependencies so we start clean
    const actIds = await prisma.scheduleActivityV2.findMany({
      where: { scheduleId },
      select: { id: true },
    });
    const ids = actIds.map((a) => a.id);
    if (ids.length > 0) {
      await prisma.scheduleDependency.deleteMany({
        where: { OR: [{ predecessorId: { in: ids } }, { successorId: { in: ids } }] },
      });
      await prisma.scheduleActivityV2.deleteMany({ where: { scheduleId } });
    }
  }

  const existing = await prisma.scheduleActivityV2.findMany({
    where: { scheduleId },
    select: { id: true, activityCode: true },
  });
  const existingCodes = new Set(existing.map((a) => a.activityCode));
  result.activitiesSkipped = existing.length;

  const bidTrades = await prisma.bidTrade.findMany({
    where: { bidId },
    include: { trade: true },
  });
  result.tradesScanned = bidTrades.length;

  // ── Prefer spec sections as the source of truth for what's in the project ─
  // When a spec book with analyzed sections exists, use it to drive procurement
  // activity creation (which divisions are present + canonical titles).
  // Falls back to BidTrades when no spec book exists yet.
  const specBook = await prisma.specBook.findFirst({
    where: { bidId, status: "ready" },
    orderBy: { uploadedAt: "desc" },
    include: {
      sections: {
        select: { csiNumber: true, csiCanonicalTitle: true, csiTitle: true },
      },
    },
  });

  // Build a division → canonical title map from spec sections
  const specDivTitles = new Map<string, string>();
  for (const s of specBook?.sections ?? []) {
    const div = csiDivision(s.csiNumber);
    if (div && !specDivTitles.has(div)) {
      specDivTitles.set(div, s.csiCanonicalTitle ?? s.csiTitle);
    }
  }

  // Determine which long-lead divisions are in this project:
  //   - spec-sourced when available (more accurate)
  //   - BidTrades fallback when no spec book
  const useSpecSource = specDivTitles.size > 0;
  const longLeadDivs: Array<{ div: string; name: string }> = [];

  if (useSpecSource) {
    for (const [div, title] of specDivTitles.entries()) {
      if (!LONG_LEAD_PROCUREMENT[div]) continue;
      longLeadDivs.push({ div, name: title });
    }
  } else {
    for (const bt of bidTrades) {
      const div = csiDivision(bt.trade.csiCode);
      if (!div || !LONG_LEAD_PROCUREMENT[div]) continue;
      longLeadDivs.push({ div, name: bt.trade.name });
    }
  }

  if (!existingCodes.has("P1000")) {
    // ── Build procurement rows from long-lead divisions ──────────────────────
    const procRows: TemplateRow[] = [];
    let procIdx = 0;
    for (const { div, name } of longLeadDivs) {
      procIdx++;
      procRows.push({
        code: `P20${String(procIdx).padStart(2, "0")}`,
        name: `Procurement — ${name}`,
        dur: LONG_LEAD_PROCUREMENT[div],
        lvl: 2,
        csiDiv: div,
        trade: name,
        deps: [{ code: "P1050" }],
      });
    }

    // Insert procurement rows after P2000 in the template
    const p2Idx = GC_TEMPLATE.findIndex((r) => r.code === "P2000");
    const fullTemplate = [
      ...GC_TEMPLATE.slice(0, p2Idx + 1),
      ...procRows,
      ...GC_TEMPLATE.slice(p2Idx + 1),
    ];

    // ── Assign sortOrder and wbsId ──────────────────────────────────────────
    const codeToSort: Record<string, number> = {};
    const codeToWbs: Record<string, string> = {};
    let phaseNum = 0;
    let childIdx = 0;
    for (const row of fullTemplate) {
      if (row.lvl === 1) {
        phaseNum++;
        childIdx = 0;
        codeToSort[row.code] = (phaseNum - 1) * 1000;
        codeToWbs[row.code] = String(phaseNum);
      } else {
        childIdx++;
        codeToSort[row.code] = (phaseNum - 1) * 1000 + childIdx * 10;
        codeToWbs[row.code] = `${phaseNum}.${childIdx}`;
      }
    }

    // ── Bulk-create activities ──────────────────────────────────────────────
    const toCreate = fullTemplate.map((row) => ({
      scheduleId,
      activityCode: row.code,
      wbsId: codeToWbs[row.code] ?? "0",
      outlineLevel: row.lvl,
      sortOrder: codeToSort[row.code] ?? 0,
      name: row.name,
      duration: row.dur,
      isSummary: row.summary ?? false,
      isMilestone: row.milestone ?? false,
      requiresInspection: row.inspection ?? false,
      weatherCode: row.weather ?? "WS-0",
      csiCode: row.csiDiv ? `${row.csiDiv} 00 00` : null,
      trade: row.trade ?? null,
      notes: row.notes ?? "",
    }));

    await prisma.scheduleActivityV2.createMany({ data: toCreate });
    result.activitiesCreated = toCreate.length;

    // ── Wire dependencies ───────────────────────────────────────────────────
    const created = await prisma.scheduleActivityV2.findMany({
      where: { scheduleId },
      select: { id: true, activityCode: true },
    });
    const codeToId = new Map(created.map((a) => [a.activityCode, a.id]));

    const depsToCreate: Array<{
      predecessorId: string;
      successorId: string;
      type: string;
      lag: number;
    }> = [];

    for (const row of fullTemplate) {
      if (!row.deps?.length) continue;
      const succId = codeToId.get(row.code);
      if (!succId) continue;
      for (const d of row.deps) {
        const predId = codeToId.get(d.code);
        if (!predId) continue;
        depsToCreate.push({
          predecessorId: predId,
          successorId: succId,
          type: d.type ?? "FS",
          lag: d.lag ?? 0,
        });
      }
    }

    // Procurement activities → field activities
    for (const pr of procRows) {
      const procId = codeToId.get(pr.code);
      const fieldCodes = LONG_LEAD_FIELD[pr.csiDiv ?? ""] ?? [];
      for (const fc of fieldCodes) {
        const fieldId = codeToId.get(fc);
        if (procId && fieldId) {
          depsToCreate.push({ predecessorId: procId, successorId: fieldId, type: "FS", lag: 0 });
        }
      }
    }

    if (depsToCreate.length > 0) {
      await prisma.scheduleDependency.createMany({ data: depsToCreate });
    }
  }

  // ── Stamp trade names from BidTrades onto matching template activities ────
  // Runs on every seed (including re-seed) so trade roster changes propagate.
  const allActivities = await prisma.scheduleActivityV2.findMany({
    where: { scheduleId },
    select: { id: true, activityCode: true },
  });
  const codeToId = new Map(allActivities.map((a) => [a.activityCode, a.id]));

  for (const bt of bidTrades) {
    const div = csiDivision(bt.trade.csiCode);
    if (!div) continue;
    const targetCode = DIV_TRADE_CODE[div];
    if (!targetCode) continue;
    const id = codeToId.get(targetCode);
    if (!id) continue;
    await prisma.scheduleActivityV2.update({
      where: { id },
      data: { trade: bt.trade.name },
    });
  }

  await recalculateScheduleV2(scheduleId);
  return result;
}

function buildActivityCode(index: number): string {
  return `A${String(1010 + index * 10).padStart(4, "0")}`;
}

// ── Activity CRUD ─────────────────────────────────────────────────────────────

export type ActivityCreateInput = {
  name: string;
  duration?: number;
  outlineLevel?: number;
  isMilestone?: boolean;
  csiCode?: string | null;
  trade?: string | null;
  notes?: string;
  insertAfterSortOrder?: number; // insert after this sortOrder; null = append
};

export type ActivityUpdateInput = Partial<{
  name: string;
  duration: number;
  outlineLevel: number;
  isMilestone: boolean;
  csiCode: string | null;
  trade: string | null;
  notes: string;
  status: string;
  percentComplete: number;
  weatherCode: string;
  requiresInspection: boolean;
  delayReason: string | null;
}>;

export type MutationResult =
  | { ok: true; activityId?: string; activities?: ActivityV2[] }
  | { ok: false; error: string };

export async function createActivityV2(
  scheduleId: string,
  input: ActivityCreateInput
): Promise<MutationResult> {
  if (!input.name?.trim()) return { ok: false, error: "name is required" };

  const allActivities = await prisma.scheduleActivityV2.findMany({
    where: { scheduleId },
    select: { id: true, activityCode: true, sortOrder: true },
    orderBy: { sortOrder: "asc" },
  });

  const codeIndex = allActivities.filter((a) => a.activityCode.startsWith("A")).length;
  const activityCode = buildActivityCode(codeIndex);

  // Compute sortOrder: insert after given position or append
  let sortOrder: number;
  if (input.insertAfterSortOrder != null) {
    // Shift everything after the insert point up by 10
    const affected = allActivities.filter((a) => a.sortOrder > input.insertAfterSortOrder!);
    for (const a of affected) {
      await prisma.scheduleActivityV2.update({
        where: { id: a.id },
        data: { sortOrder: a.sortOrder + 10 },
      });
    }
    sortOrder = input.insertAfterSortOrder + 5; // slot between
  } else {
    const max = allActivities.reduce((m, a) => Math.max(m, a.sortOrder), 0);
    sortOrder = max + 10;
  }

  const created = await prisma.scheduleActivityV2.create({
    data: {
      scheduleId,
      activityCode,
      wbsId: "",
      outlineLevel: input.outlineLevel ?? 3,
      sortOrder,
      name: input.name.trim(),
      duration: input.duration ?? 5,
      isMilestone: input.isMilestone ?? false,
      csiCode: input.csiCode ?? null,
      trade: input.trade ?? null,
      notes: input.notes ?? "",
    },
  });

  const activities = await recalculateScheduleV2(scheduleId);
  return { ok: true, activityId: created.id, activities };
}

export async function updateActivityV2(
  scheduleId: string,
  activityId: string,
  input: ActivityUpdateInput,
  depsInput?: { predecessorCode: string; type: string; lag: number }[]
): Promise<MutationResult> {
  const existing = await prisma.scheduleActivityV2.findUnique({
    where: { id: activityId },
    select: { id: true, scheduleId: true },
  });
  if (!existing || existing.scheduleId !== scheduleId)
    return { ok: false, error: "Activity not found" };

  const data: Record<string, unknown> = {};
  const fields: (keyof ActivityUpdateInput)[] = [
    "name", "duration", "outlineLevel", "isMilestone", "csiCode", "trade",
    "notes", "status", "percentComplete", "weatherCode", "requiresInspection", "delayReason",
  ];
  for (const f of fields) {
    if (f in input) data[f] = input[f as keyof ActivityUpdateInput];
  }

  await prisma.scheduleActivityV2.update({ where: { id: activityId }, data });

  // If predecessor list was provided, reconcile ScheduleDependency rows
  if (depsInput !== undefined) {
    await reconcileDependencies(scheduleId, activityId, depsInput);
  }

  const activities = await recalculateScheduleV2(scheduleId);
  return { ok: true, activities };
}

export async function deleteActivityV2(
  scheduleId: string,
  activityId: string
): Promise<MutationResult> {
  const existing = await prisma.scheduleActivityV2.findUnique({
    where: { id: activityId },
    select: { id: true, scheduleId: true },
  });
  if (!existing || existing.scheduleId !== scheduleId)
    return { ok: false, error: "Activity not found" };

  await prisma.scheduleActivityV2.delete({ where: { id: activityId } });
  const activities = await recalculateScheduleV2(scheduleId);
  return { ok: true, activities };
}

// ── Dependency reconciliation ─────────────────────────────────────────────────
//
// Given a desired predecessor list for an activity, delete obsolete deps and
// create new ones. `predecessorCode` refers to the activityCode field.

async function reconcileDependencies(
  scheduleId: string,
  successorId: string,
  desired: { predecessorCode: string; type: string; lag: number }[]
): Promise<void> {
  const allActivities = await prisma.scheduleActivityV2.findMany({
    where: { scheduleId },
    select: { id: true, activityCode: true },
  });
  const codeToId = new Map(allActivities.map((a) => [a.activityCode, a.id]));

  const desiredRows = desired
    .map((d) => ({
      predecessorId: codeToId.get(d.predecessorCode),
      successorId,
      type: d.type || "FS",
      lag: d.lag || 0,
    }))
    .filter((d) => d.predecessorId != null) as Array<{
    predecessorId: string;
    successorId: string;
    type: string;
    lag: number;
  }>;

  // Delete all existing deps for this successor
  await prisma.scheduleDependency.deleteMany({ where: { successorId } });

  // Re-create
  if (desiredRows.length > 0) {
    await prisma.scheduleDependency.createMany({ data: desiredRows });
  }
}

// ── Predecessor string helpers ────────────────────────────────────────────────
//
// Format: comma-separated tokens like "A1010FS", "A1020FS-4d", "A1030SS+2d"
// Parsed into { predecessorCode, type, lag }

export function formatPredecessors(
  successorId: string,
  deps: DepRow[],
  activities: ActivityV2[]
): string {
  const codeMap = new Map(activities.map((a) => [a.id, a.activityCode]));
  return deps
    .filter((d) => d.successorId === successorId)
    .map((d) => {
      const code = codeMap.get(d.predecessorId) ?? "?";
      const type = d.type === "FS" ? "FS" : d.type;
      const lagStr = d.lag === 0 ? "" : d.lag > 0 ? `+${d.lag}d` : `${d.lag}d`;
      return `${code}${type}${lagStr}`;
    })
    .join(", ");
}

export function parsePredecessorString(
  str: string
): { predecessorCode: string; type: string; lag: number }[] {
  if (!str.trim()) return [];
  return str
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      // e.g. "A1010FS-4d", "A1020", "A1030SS+2d"
      const match = token.match(/^([A-Z]\d+)(FS|SS|FF|SF)?([+-]\d+d)?$/i);
      if (!match) return null;
      const predecessorCode = match[1].toUpperCase();
      const type = (match[2] ?? "FS").toUpperCase();
      const lagStr = match[3] ?? "";
      const lag = lagStr ? parseInt(lagStr.replace("d", ""), 10) : 0;
      return { predecessorCode, type, lag };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}
