// ──────────────────────────────────────────────────────────────────────────────
//  lib/services/portfolio/morningStrip.ts
//
//  Data loader for the /portfolio "Morning Strip" V0 — a truthful, read-only
//  summary of what already exists in the data model. Deliberately narrow:
//  no new tracking, no derived/stored values, no fabricated status.
//
//  Sources (all pre-existing):
//    - BackgroundJob.status/completedAt — canonical FSM from
//      lib/services/jobs/backgroundJobService.ts (queued → running →
//      complete | failed | cancelled). "failed" and "complete" both set
//      completedAt, so "failed in the last 24h" is a plain status+timestamp
//      filter — no new field needed.
//    - Bid.dueDate — the bid submission deadline. Nullable; a bid with no
//      dueDate is simply excluded (never treated as overdue/due-now).
//    - SubmittalItem.submitByDate — Phase 5G-2 schedule-tied due date
//      (backward math from a linked schedule activity). Already relied on
//      by the root dashboard (app/page.tsx) for its 7-day strip, and has a
//      real deep link via the bid page's "submittals" tab, so it qualifies
//      as a reliable "Today" source per the Morning Strip spec.
//
//  Explicitly NOT included (see task write-up for reasoning):
//    - Any notion of "AI analysis succeeded" — BackgroundJob.status only
//      tells us the job *executed* to completion, never that its output is
//      correct. Completed-job info is surfaced as "N jobs completed", not
//      as a quality claim.
//    - AI/provider health — this module has no way to know if a provider is
//      reachable and must not imply otherwise.
// ──────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";

// "Due soon" window shared by both Today tiles. 5 days: long enough to give
// useful lead time on an approaching bid deadline or submittal action, short
// enough that the strip stays a "what needs attention this week" signal
// rather than duplicating the full pipeline views that already exist on
// /bids and within each bid page. This is a judgment call — flagged in the
// task return for human review.
export const DUE_SOON_WINDOW_DAYS = 5;

// Bid statuses for which dueDate is still an actionable deadline. Once a bid
// is "submitted" (or later: awarded/lost/cancelled), the due date is a
// historical fact, not something today's attention changes.
const PRE_SUBMISSION_STATUSES = ["draft", "active", "leveling"];

// SubmittalItem statuses that are not yet resolved — mirrors the
// isTerminal() check in lib/services/submittal/submittalService.ts
// (status === "APPROVED" || "APPROVED_AS_NOTED").
const OPEN_SUBMITTAL_STATUSES = [
  "PENDING",
  "REQUESTED",
  "RECEIVED",
  "UNDER_REVIEW",
  "REJECTED",
  "RESUBMIT",
];

// Bounded list size for every "show a few examples" query below — keeps
// every query a single, fixed-cost round trip regardless of how much data
// exists (no N+1 / no unbounded scans rendered to the page).
const MAX_LIST_ITEMS = 5;

export interface JobSummary {
  id: string;
  jobType: string;
  bidId: number;
  bidProjectName: string;
  completedAt: Date;
}

export interface BidDueSoonSummary {
  id: number;
  projectName: string;
  dueDate: Date;
  status: string;
}

export interface SubmittalDueSoonSummary {
  id: number;
  title: string;
  bidId: number;
  bidProjectName: string;
  submitByDate: Date;
}

export interface MorningStripData {
  failedJobs: { total: number; items: JobSummary[] };
  completedJobs: { total: number; items: JobSummary[] };
  bidsDueSoon: { total: number; items: BidDueSoonSummary[] };
  submittalsDueSoon: { total: number; items: SubmittalDueSoonSummary[] };
  windowDays: number;
  isQuiet: boolean;
}

export async function loadMorningStrip(now: Date = new Date()): Promise<MorningStripData> {
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Only jobs still attached to a live bid can carry a deep link — a job
  // whose bid was deleted has bidId set to null (onDelete: SetNull) and is
  // excluded from both the count and the list so every displayed number
  // has somewhere real to click through to.
  const jobWhere = (status: "failed" | "complete") => ({
    status,
    completedAt: { gte: since24h },
    bidId: { not: null },
  });

  const [
    failedTotal,
    failedItemsRaw,
    completedTotal,
    completedItemsRaw,
    bidsTotal,
    bidsItemsRaw,
    submittalsTotal,
    submittalsItemsRaw,
  ] = await Promise.all([
    prisma.backgroundJob.count({ where: jobWhere("failed") }),
    prisma.backgroundJob.findMany({
      where: jobWhere("failed"),
      orderBy: { completedAt: "desc" },
      take: MAX_LIST_ITEMS,
      select: {
        id: true,
        jobType: true,
        bidId: true,
        completedAt: true,
        bid: { select: { projectName: true } },
      },
    }),
    prisma.backgroundJob.count({ where: jobWhere("complete") }),
    prisma.backgroundJob.findMany({
      where: jobWhere("complete"),
      orderBy: { completedAt: "desc" },
      take: MAX_LIST_ITEMS,
      select: {
        id: true,
        jobType: true,
        bidId: true,
        completedAt: true,
        bid: { select: { projectName: true } },
      },
    }),
    prisma.bid.count({
      where: { dueDate: { not: null, lte: windowEnd }, status: { in: PRE_SUBMISSION_STATUSES } },
    }),
    prisma.bid.findMany({
      where: { dueDate: { not: null, lte: windowEnd }, status: { in: PRE_SUBMISSION_STATUSES } },
      orderBy: { dueDate: "asc" },
      take: MAX_LIST_ITEMS,
      select: { id: true, projectName: true, dueDate: true, status: true },
    }),
    prisma.submittalItem.count({
      where: {
        status: { in: OPEN_SUBMITTAL_STATUSES },
        submitByDate: { not: null, lte: windowEnd },
      },
    }),
    prisma.submittalItem.findMany({
      where: {
        status: { in: OPEN_SUBMITTAL_STATUSES },
        submitByDate: { not: null, lte: windowEnd },
      },
      orderBy: { submitByDate: "asc" },
      take: MAX_LIST_ITEMS,
      select: {
        id: true,
        title: true,
        bidId: true,
        submitByDate: true,
        bid: { select: { projectName: true } },
      },
    }),
  ]);

  const toJobSummary = (
    rows: typeof failedItemsRaw
  ): JobSummary[] =>
    rows
      .filter(
        (r): r is typeof r & { bidId: number; completedAt: Date; bid: { projectName: string } } =>
          r.bidId != null && r.completedAt != null && r.bid != null
      )
      .map((r) => ({
        id: r.id,
        jobType: r.jobType,
        bidId: r.bidId,
        bidProjectName: r.bid.projectName,
        completedAt: r.completedAt,
      }));

  const bidsDueSoon: BidDueSoonSummary[] = bidsItemsRaw
    .filter((b): b is typeof b & { dueDate: Date } => b.dueDate != null)
    .map((b) => ({ id: b.id, projectName: b.projectName, dueDate: b.dueDate, status: b.status }));

  const submittalsDueSoon: SubmittalDueSoonSummary[] = submittalsItemsRaw
    .filter(
      (s): s is typeof s & { submitByDate: Date } => s.submitByDate != null
    )
    .map((s) => ({
      id: s.id,
      title: s.title,
      bidId: s.bidId,
      bidProjectName: s.bid.projectName,
      submitByDate: s.submitByDate,
    }));

  // Quiet state is about ACTIONABLE items only. Recently-completed jobs are
  // informational ("job completed" facts), not something that needs today's
  // attention, so they never block the quiet state on their own.
  const isQuiet = failedTotal === 0 && bidsTotal === 0 && submittalsTotal === 0;

  return {
    failedJobs: { total: failedTotal, items: toJobSummary(failedItemsRaw) },
    completedJobs: { total: completedTotal, items: toJobSummary(completedItemsRaw) },
    bidsDueSoon: { total: bidsTotal, items: bidsDueSoon },
    submittalsDueSoon: { total: submittalsTotal, items: submittalsDueSoon },
    windowDays: DUE_SOON_WINDOW_DAYS,
    isQuiet,
  };
}
