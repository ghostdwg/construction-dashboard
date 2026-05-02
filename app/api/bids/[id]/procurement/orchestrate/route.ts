// POST /api/bids/[id]/procurement/orchestrate
//
// Links SubmittalPackages to schedule activities, runs backward date math on
// all items, and sets riskStatus + readyForExport on each package.
//
// Body (all optional):
//   dryRun          — boolean, default false: compute and return results without persisting
//   autoLink        — boolean, default true: attempt to auto-link unlinked packages by CSI/trade match
//   riskWindowDays  — integer, default 14: days within which submitByDate triggers AT_RISK
//
// Returns:
//   { packagesProcessed, itemsUpdated, linked, atRisk, blocked, readyForExport, warnings }

import { prisma } from "@/lib/prisma";

const RISK_WINDOW_DEFAULT = 14;

// Working-day subtraction (Mon–Fri). Skips weekends only — no holiday calendar.
function subtractWorkDays(from: Date, days: number): Date {
  const result = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() - 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return result;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const body = await request.json().catch(() => ({})) as {
    dryRun?: boolean;
    autoLink?: boolean;
    riskWindowDays?: number;
  };

  const dryRun = body.dryRun ?? false;
  const autoLink = body.autoLink ?? true;
  const riskWindowDays = typeof body.riskWindowDays === "number" ? body.riskWindowDays : RISK_WINDOW_DEFAULT;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const atRiskCutoff = new Date(today);
  atRiskCutoff.setDate(atRiskCutoff.getDate() + riskWindowDays);

  // Load packages with items + trade linkage
  const packages = await prisma.submittalPackage.findMany({
    where: { bidId },
    include: {
      items: {
        select: {
          id: true,
          status: true,
          linkedActivityId: true,
          leadTimeDays: true,
          reviewBufferDays: true,
          resubmitBufferDays: true,
        },
      },
      bidTrade: {
        select: { trade: { select: { name: true, csiCode: true } } },
      },
    },
  });

  if (packages.length === 0) {
    return Response.json({
      packagesProcessed: 0,
      itemsUpdated: 0,
      linked: 0,
      atRisk: 0,
      blocked: 0,
      readyForExport: 0,
      warnings: ["No submittal packages found for this bid."],
    });
  }

  // Load schedule activities for this bid (first schedule wins)
  const schedule = await prisma.schedule.findFirst({
    where: { bidId },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const activities = schedule
    ? await prisma.scheduleActivityV2.findMany({
        where: { scheduleId: schedule.id, isSummary: false },
        select: {
          id: true,
          name: true,
          csiCode: true,
          trade: true,
          startDate: true,
          finishDate: true,
        },
      })
    : [];

  const warnings: string[] = [];
  if (!schedule) warnings.push("No schedule found — cannot link activities or compute dates.");

  // Index activities by csiCode prefix and trade name for auto-linking
  const actByCSI = new Map<string, typeof activities[0]>();
  const actByTrade = new Map<string, typeof activities[0]>();
  for (const act of activities) {
    if (act.csiCode) {
      const prefix = act.csiCode.replace(/\s+/g, "").slice(0, 4); // "0330" from "03 30 00"
      if (!actByCSI.has(prefix)) actByCSI.set(prefix, act);
    }
    if (act.trade) {
      const key = act.trade.toLowerCase().trim();
      if (!actByTrade.has(key)) actByTrade.set(key, act);
    }
  }

  type PackageUpdate = {
    id: number;
    linkedActivityId?: string;
    riskStatus: "NONE" | "AT_RISK" | "BLOCKED";
    readyForExport: boolean;
  };

  type ItemUpdate = {
    id: number;
    requiredOnSiteDate: Date | null;
    submitByDate: Date | null;
  };

  const packageUpdates: PackageUpdate[] = [];
  const itemUpdates: ItemUpdate[] = [];
  let linkedCount = 0;

  for (const pkg of packages) {
    let resolvedActivityId = pkg.linkedActivityId;
    let resolvedActivity = activities.find((a) => a.id === resolvedActivityId) ?? null;

    // Auto-link if not already linked and autoLink is on
    if (!resolvedActivityId && autoLink && activities.length > 0) {
      const tradeName = pkg.bidTrade?.trade?.name?.toLowerCase().trim();
      const csiCode = pkg.bidTrade?.trade?.csiCode?.replace(/\s+/g, "").slice(0, 4);

      if (csiCode && actByCSI.has(csiCode)) {
        resolvedActivity = actByCSI.get(csiCode)!;
      } else if (tradeName && actByTrade.has(tradeName)) {
        resolvedActivity = actByTrade.get(tradeName)!;
      }

      if (resolvedActivity) {
        resolvedActivityId = resolvedActivity.id;
        linkedCount++;
      }
    }

    const _installStart = resolvedActivity?.startDate ?? null;

    // Effective package-level defaults (fall through to item-level)
    const pkgLeadTime = pkg.defaultLeadTimeDays ?? 0;
    const pkgReviewBuffer = pkg.defaultReviewBufferDays ?? 21;
    const pkgResubmitBuffer = pkg.defaultResubmitBufferDays ?? 7;

    // Terminal status set — items in these states are not risk-scored
    const CLOSED_STATUSES = new Set(["APPROVED", "APPROVED_AS_NOTED"]);

    let pkgRiskStatus: "NONE" | "AT_RISK" | "BLOCKED" = "NONE";
    let hasComputedDate = false;

    for (const item of pkg.items) {
      if (CLOSED_STATUSES.has(item.status)) {
        itemUpdates.push({ id: item.id, requiredOnSiteDate: null, submitByDate: null });
        continue;
      }

      // Resolve effective activity for this item: item-level link takes precedence
      const itemActivity = item.linkedActivityId
        ? activities.find((a) => a.id === item.linkedActivityId) ?? resolvedActivity
        : resolvedActivity;

      const installDate = itemActivity?.startDate ?? null;

      if (!installDate) {
        itemUpdates.push({ id: item.id, requiredOnSiteDate: null, submitByDate: null });
        continue;
      }

      const lead = item.leadTimeDays !== 0 ? item.leadTimeDays : pkgLeadTime;
      const review = item.reviewBufferDays !== 21 ? item.reviewBufferDays : pkgReviewBuffer;
      const resubmit = item.resubmitBufferDays !== 7 ? item.resubmitBufferDays : pkgResubmitBuffer;

      const requiredOnSiteDate = subtractWorkDays(installDate, lead);
      const submitByDate = subtractWorkDays(requiredOnSiteDate, review + resubmit);

      hasComputedDate = true;
      itemUpdates.push({ id: item.id, requiredOnSiteDate, submitByDate });

      // Risk scoring
      if (submitByDate < today) {
        pkgRiskStatus = "BLOCKED";
      } else if (pkgRiskStatus !== "BLOCKED" && submitByDate <= atRiskCutoff) {
        pkgRiskStatus = "AT_RISK";
      }
    }

    const readyForExport = !!resolvedActivityId && hasComputedDate && pkgRiskStatus !== "BLOCKED";

    packageUpdates.push({
      id: pkg.id,
      ...(resolvedActivityId && resolvedActivityId !== pkg.linkedActivityId
        ? { linkedActivityId: resolvedActivityId }
        : {}),
      riskStatus: pkgRiskStatus,
      readyForExport,
    });
  }

  // Persist unless dry run
  if (!dryRun) {
    await prisma.$transaction([
      ...packageUpdates.map((u) =>
        prisma.submittalPackage.update({
          where: { id: u.id },
          data: {
            ...(u.linkedActivityId !== undefined ? { linkedActivityId: u.linkedActivityId } : {}),
            riskStatus: u.riskStatus,
            readyForExport: u.readyForExport,
          },
        })
      ),
      ...itemUpdates.map((u) =>
        prisma.submittalItem.update({
          where: { id: u.id },
          data: {
            requiredOnSiteDate: u.requiredOnSiteDate,
            submitByDate: u.submitByDate,
          },
        })
      ),
    ]);
  }

  return Response.json({
    packagesProcessed: packages.length,
    itemsUpdated: itemUpdates.length,
    linked: linkedCount,
    atRisk: packageUpdates.filter((p) => p.riskStatus === "AT_RISK").length,
    blocked: packageUpdates.filter((p) => p.riskStatus === "BLOCKED").length,
    readyForExport: packageUpdates.filter((p) => p.readyForExport).length,
    warnings,
    dryRun,
  });
}
