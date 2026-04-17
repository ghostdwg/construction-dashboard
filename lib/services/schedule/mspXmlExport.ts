// Phase 5C + Tier F F4 — MSP XML 2007 export
//
// Generates Microsoft Project 2007 XML (.xml) from a ScheduleV2.
// This is the format Procore's schedule import accepts alongside .mpp, .xer, .pp.
//
// Dependency type mapping (our system → MSP XML type attribute):
//   FS → 1  SS → 3  FF → 0  SF → 2
//
// Duration: ISO 8601 PT format, 8 working hours per day.
// LinkLag: tenths-of-minutes units (1 working day = 480 min × 10 = 4800 units).
// LagFormat 7 = days (MSP canonical display unit).

import { getScheduleForBid } from "@/lib/services/schedule/scheduleV2Service";
import type { ActivityV2, DepRow } from "@/lib/services/schedule/scheduleV2Service";

// ── Dependency type mapping ───────────────────────────────────────────────────

const DEP_TYPE_MAP: Record<string, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };

function mspDepType(type: string): number {
  return DEP_TYPE_MAP[type.toUpperCase()] ?? 1; // default FS
}

// 1 working day = 8 hours = 480 minutes × 10 = 4800 tenths-of-minutes
function lagToLinkLag(lagDays: number): number {
  return lagDays * 4800;
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function el(tag: string, value: string | number): string {
  return `<${tag}>${value}</${tag}>`;
}

// MSP stores times as local ISO strings at 08:00 (start) or 17:00 (finish)
function dateToMsp(iso: string | null, time: "08:00:00" | "17:00:00"): string {
  if (!iso) return "";
  return iso.slice(0, 10) + "T" + time;
}

// ISO 8601 duration: 1 working day = 8 hours → PT8H0M0S
function durationToIso(days: number): string {
  return `PT${days * 8}H0M0S`;
}

// ── Task XML builder ──────────────────────────────────────────────────────────

function buildTaskXml(
  uid: number,
  id: number,
  activity: ActivityV2,
  deps: DepRow[],
  uidMap: Map<string, number>
): string {
  const predecessors = deps
    .filter((d) => d.successorId === activity.id && uidMap.has(d.predecessorId))
    .map((d) => {
      const predUid = uidMap.get(d.predecessorId)!;
      return [
        "<PredecessorLink>",
        el("PredecessorUID", predUid),
        el("Type", mspDepType(d.type)),
        el("LinkLag", lagToLinkLag(d.lag)),
        el("LagFormat", 7), // 7 = days
        "</PredecessorLink>",
      ].join("");
    })
    .join("");

  const startIso = dateToMsp(activity.startDate, "08:00:00");
  const finishIso = dateToMsp(activity.finishDate, "17:00:00");
  const duration = activity.isMilestone ? "PT0H0M0S" : durationToIso(activity.duration);

  const parts = [
    "<Task>",
    el("UID", uid),
    el("ID", id),
    el("Name", xmlEscape(activity.name)),
    el("OutlineLevel", activity.outlineLevel),
    el("WBS", xmlEscape(activity.wbsId || String(id))),
    el("Summary", activity.isSummary ? 1 : 0),
    el("Milestone", activity.isMilestone ? 1 : 0),
    el("Duration", duration),
    startIso ? el("Start", startIso) : "",
    finishIso ? el("Finish", finishIso) : "",
    activity.notes ? el("Notes", xmlEscape(activity.notes)) : "",
    activity.trade ? el("ResourceNames", xmlEscape(activity.trade)) : "",
    predecessors,
    "</Task>",
  ];

  return parts.filter(Boolean).join("");
}

// ── Public API ────────────────────────────────────────────────────────────────

export type MspXmlResult = {
  xml: string;
  scheduleName: string;
  activityCount: number;
};

export async function buildMspXml(bidId: number): Promise<MspXmlResult> {
  const result = await getScheduleForBid(bidId);
  if (!result) throw new Error("No schedule found for this bid.");

  const { schedule, activities, deps } = result;

  // Assign UIDs: 0 = project root task (MSP requires it), 1..N = activities
  const uidMap = new Map<string, number>();
  activities.forEach((a, i) => uidMap.set(a.id, i + 1));

  // Project-level dates for the root task
  const projectStart = dateToMsp(schedule.startDate, "08:00:00");
  const projectFinish = activities.reduce<string | null>((max, a) => {
    if (!a.finishDate) return max;
    return !max || a.finishDate > max ? a.finishDate : max;
  }, null);

  const rootTask = [
    "<Task>",
    el("UID", 0),
    el("ID", 0),
    el("Name", xmlEscape(schedule.name)),
    el("OutlineLevel", 0),
    el("Summary", 1),
    projectStart ? el("Start", projectStart) : "",
    projectFinish ? el("Finish", dateToMsp(projectFinish, "17:00:00")) : "",
    "</Task>",
  ]
    .filter(Boolean)
    .join("");

  const taskLines = activities
    .map((a, i) => buildTaskXml(i + 1, i + 1, a, deps, uidMap))
    .join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    el("Name", xmlEscape(schedule.name)),
    projectStart ? el("StartDate", projectStart) : "",
    "<CalendarUID>1</CalendarUID>",
    "<Tasks>",
    rootTask,
    taskLines,
    "</Tasks>",
    "</Project>",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    xml,
    scheduleName: schedule.name,
    activityCount: activities.length,
  };
}
