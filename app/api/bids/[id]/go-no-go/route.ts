import { prisma } from "@/lib/prisma";
import { calculateTimeline } from "@/lib/services/procurement/calculateTimeline";

// ----- Types -----

type CheckStatus = "pass" | "caution" | "fail";
type Score = "GO" | "CAUTION" | "NO-GO";

type Check = {
  label: string;
  status: CheckStatus;
  detail: string;
};

type Gate = {
  id: "readiness" | "procurement" | "scope" | "deadline" | "compliance";
  label: string;
  score: Score;
  checks: Check[];
};

// ----- Scoring helpers -----

function gateScore(checks: Check[]): Score {
  if (checks.some((c) => c.status === "fail")) return "NO-GO";
  if (checks.some((c) => c.status === "caution")) return "CAUTION";
  return "GO";
}

function overallScore(gates: Gate[]): Score {
  if (gates.some((g) => g.score === "NO-GO")) return "NO-GO";
  if (gates.some((g) => g.score === "CAUTION")) return "CAUTION";
  return "GO";
}

// ----- GET /api/bids/[id]/go-no-go -----

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const bidId = parseInt(id, 10);
  if (isNaN(bidId)) return Response.json({ error: "Invalid id" }, { status: 400 });

  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    select: {
      id: true,
      dueDate: true,
      projectType: true,
      complianceChecklist: true,
      // INT1 — intake fields used by the new Project Context check
      deliveryMethod: true,
      ownerType: true,
      buildingType: true,
      approxSqft: true,
      stories: true,
      ldAmountPerDay: true,
      ldCapAmount: true,
      dbeGoalPercent: true,
      occupiedSpace: true,
      phasingRequired: true,
      siteConstraints: true,
      estimatorNotes: true,
      scopeBoundaryNotes: true,
      veInterest: true,
    },
  });
  if (!bid) return Response.json({ error: "Bid not found" }, { status: 404 });

  // ----- Parallel data load -----
  const [
    brief,
    bidTrades,
    specBookCount,
    drawingUploadCount,
    allSelections,
    approvedEstimateCount,
    totalGapFindings,
    criticalUnresolvedCount,
  ] = await Promise.all([
    prisma.bidIntelligenceBrief.findUnique({
      where: { bidId },
      select: {
        status: true,
        riskFlags: true,
        assumptionsToResolve: true,
        isStale: true,
        generatedAt: true,
      },
    }),
    prisma.bidTrade.findMany({
      where: { bidId },
      select: {
        tradeId: true,
        tier: true,
        leadTimeDays: true,
        rfqSentAt: true,
        quotesReceivedAt: true,
        trade: { select: { name: true } },
      },
    }),
    prisma.specBook.count({ where: { bidId } }),
    prisma.drawingUpload.count({ where: { bidId } }),
    prisma.bidInviteSelection.findMany({
      where: { bidId },
      select: { tradeId: true },
    }),
    prisma.estimateUpload.count({
      where: { bidId, approvedForAi: true, sanitizedText: { not: null } },
    }),
    prisma.aiGapFinding.count({ where: { bidId } }),
    prisma.aiGapFinding.count({
      where: {
        bidId,
        severity: "critical",
        generatedQuestions: { none: {} },
      },
    }),
  ]);

  // ----- Parse JSON fields from brief -----
  let criticalRiskFlagCount = 0;
  let beforeInviteAssumptionCount = 0;

  if (brief?.riskFlags) {
    try {
      const flags = JSON.parse(brief.riskFlags) as { severity: string }[];
      criticalRiskFlagCount = flags.filter((f) => f.severity === "critical").length;
    } catch { /* ignore */ }
  }
  if (brief?.assumptionsToResolve) {
    try {
      const assumptions = JSON.parse(brief.assumptionsToResolve) as { urgency: string }[];
      beforeInviteAssumptionCount = assumptions.filter((a) => a.urgency === "before_invite").length;
    } catch { /* ignore */ }
  }

  // ----- Days until due -----
  const now = new Date();
  const dueDate = bid.dueDate ? new Date(bid.dueDate) : null;
  const daysUntilDue = dueDate
    ? Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // ----- Invite coverage per trade -----
  const tradeIds = bidTrades.map((bt) => bt.tradeId);
  const invitedTradeIds = new Set(
    allSelections.map((s) => s.tradeId).filter((tid): tid is number => tid !== null)
  );
  const totalInvites = allSelections.length;
  const tradesWithInvites = tradeIds.filter((tid) => invitedTradeIds.has(tid)).length;

  // ── GATE 1 — Project Readiness ──────────────────────────────────────────────

  const docsUploaded = specBookCount > 0 || drawingUploadCount > 0;
  const briefReady = !!brief && brief.status === "ready";
  const docCount = specBookCount + drawingUploadCount;

  // ----- INT1 — Project Context completeness -----
  // Count populated intake fields. The total varies because PUBLIC bids carry
  // 3 extra fields (LD per day, LD cap, DBE goal).
  const intakeBaseFields: Array<unknown> = [
    bid.deliveryMethod,
    bid.ownerType,
    bid.buildingType,
    bid.approxSqft,
    bid.stories,
    bid.siteConstraints,
    bid.estimatorNotes,
    bid.scopeBoundaryNotes,
    // Booleans only count when true (presence-based)
    bid.occupiedSpace || null,
    bid.phasingRequired || null,
    bid.veInterest || null,
  ];
  const intakePublicExtras: Array<unknown> = [
    bid.ldAmountPerDay,
    bid.ldCapAmount,
    bid.dbeGoalPercent,
  ];
  const intakeFields =
    bid.projectType === "PUBLIC"
      ? [...intakeBaseFields, ...intakePublicExtras]
      : intakeBaseFields;
  const intakePopulated = intakeFields.filter(
    (v) => v !== null && v !== undefined && v !== ""
  ).length;
  const intakeTotal = intakeFields.length;
  const intakePct = intakeTotal > 0 ? intakePopulated / intakeTotal : 0;

  let intakeStatus: CheckStatus;
  let intakeDetail: string;
  if (intakePopulated === 0) {
    intakeStatus = "fail";
    intakeDetail = "Project intake not started — run the intake form on Overview";
  } else if (intakePct < 0.5) {
    intakeStatus = "caution";
    intakeDetail = `${intakePopulated} of ${intakeTotal} intake fields populated`;
  } else {
    intakeStatus = "pass";
    intakeDetail = `${intakePopulated} of ${intakeTotal} intake fields populated`;
  }

  const readinessChecks: Check[] = [
    {
      label: "Project intake captured",
      status: intakeStatus,
      detail: intakeDetail,
    },
    {
      label: "Project documents uploaded",
      status: docsUploaded ? "pass" : "fail",
      detail: docsUploaded
        ? `${docCount} document${docCount !== 1 ? "s" : ""} uploaded`
        : "No spec book or drawing index uploaded",
    },
    {
      label: "Intelligence brief generated",
      status: briefReady ? "pass" : "fail",
      detail: briefReady ? "Brief is ready" : "Brief has not been generated",
    },
    {
      label: "Critical risk flags",
      status:
        criticalRiskFlagCount === 0
          ? "pass"
          : criticalRiskFlagCount <= 2
          ? "caution"
          : "fail",
      detail:
        criticalRiskFlagCount === 0
          ? "No critical risk flags"
          : `${criticalRiskFlagCount} critical risk flag${criticalRiskFlagCount !== 1 ? "s" : ""} in brief`,
    },
    {
      label: "Before-invite assumptions",
      status:
        beforeInviteAssumptionCount === 0
          ? "pass"
          : beforeInviteAssumptionCount <= 2
          ? "caution"
          : "fail",
      detail:
        beforeInviteAssumptionCount === 0
          ? "No unresolved before-invite assumptions"
          : `${beforeInviteAssumptionCount} assumption${beforeInviteAssumptionCount !== 1 ? "s" : ""} need resolution before invite`,
    },
  ];

  // ── GATE 2 — Procurement Health ─────────────────────────────────────────────

  const hasTrades = tradeIds.length > 0;

  let inviteStatus: CheckStatus;
  let inviteDetail: string;
  if (tradeIds.length === 0) {
    inviteStatus = "fail";
    inviteDetail = "No trades assigned — cannot check invite coverage";
  } else if (totalInvites === 0) {
    inviteStatus = "fail";
    inviteDetail = "No subs invited on any trade";
  } else if (tradesWithInvites < tradeIds.length) {
    inviteStatus = "caution";
    const missing = tradeIds.length - tradesWithInvites;
    inviteDetail = `${missing} of ${tradeIds.length} trade${tradeIds.length !== 1 ? "s" : ""} have no invited subs`;
  } else {
    inviteStatus = "pass";
    inviteDetail = `All ${tradeIds.length} trade${tradeIds.length !== 1 ? "s" : ""} have invited subs`;
  }

  let estimateStatus: CheckStatus;
  let estimateDetail: string;
  if (approvedEstimateCount > 0) {
    estimateStatus = "pass";
    estimateDetail = `${approvedEstimateCount} approved estimate${approvedEstimateCount !== 1 ? "s" : ""} received`;
  } else if (totalInvites > 0) {
    estimateStatus = "caution";
    estimateDetail = "Invites sent but no approved estimates yet";
  } else {
    estimateStatus = "fail";
    estimateDetail = "No invites sent — no estimates expected";
  }

  // ----- Tier 1 procurement status -----
  const tier1Trades = bidTrades.filter((bt) => bt.tier === "TIER1");
  let tier1OverdueCount = 0;
  let tier1AtRiskCount = 0;

  if (bid.dueDate && tier1Trades.length > 0) {
    for (const bt of tier1Trades) {
      const entry = calculateTimeline({
        tradeId: bt.tradeId,
        tradeName: bt.trade.name,
        tier: bt.tier,
        leadTimeDays: bt.leadTimeDays,
        bidDueDate: new Date(bid.dueDate),
        projectType: bid.projectType,
        rfqSentAt: bt.rfqSentAt ?? null,
        quotesReceivedAt: bt.quotesReceivedAt ?? null,
      });
      if (entry.status === "OVERDUE") tier1OverdueCount++;
      else if (entry.status === "AT_RISK") tier1AtRiskCount++;
    }
  }

  let tier1Status: CheckStatus;
  let tier1Detail: string;
  if (tier1Trades.length === 0) {
    tier1Status = "pass";
    tier1Detail = "No Tier 1 trades on this bid";
  } else if (tier1OverdueCount > 0) {
    tier1Status = "fail";
    tier1Detail = `${tier1OverdueCount} Tier 1 RFQ${tier1OverdueCount !== 1 ? "s" : ""} overdue — critical path at risk`;
  } else if (tier1AtRiskCount > 0) {
    tier1Status = "caution";
    tier1Detail = `${tier1AtRiskCount} Tier 1 RFQ${tier1AtRiskCount !== 1 ? "s" : ""} at risk — send soon`;
  } else {
    tier1Status = "pass";
    tier1Detail = `${tier1Trades.length} Tier 1 trade${tier1Trades.length !== 1 ? "s" : ""} on track`;
  }

  const procurementChecks: Check[] = [
    {
      label: "Trades confirmed on bid",
      status: hasTrades ? "pass" : "fail",
      detail: hasTrades
        ? `${tradeIds.length} trade${tradeIds.length !== 1 ? "s" : ""} confirmed`
        : "No trades assigned to this bid",
    },
    {
      label: "Subs invited per trade",
      status: inviteStatus,
      detail: inviteDetail,
    },
    {
      label: "Estimates received",
      status: estimateStatus,
      detail: estimateDetail,
    },
    {
      label: "Tier 1 critical path procurement",
      status: tier1Status,
      detail: tier1Detail,
    },
  ];

  // ── GATE 3 — Scope Confidence ────────────────────────────────────────────────

  const gapAnalysisRun = totalGapFindings > 0;

  let criticalGapStatus: CheckStatus;
  let criticalGapDetail: string;
  if (!gapAnalysisRun) {
    criticalGapStatus = "caution";
    criticalGapDetail = "Gap analysis not run — critical gaps unknown";
  } else if (criticalUnresolvedCount === 0) {
    criticalGapStatus = "pass";
    criticalGapDetail = "No unresolved critical gaps";
  } else if (criticalUnresolvedCount <= 2) {
    criticalGapStatus = "caution";
    criticalGapDetail = `${criticalUnresolvedCount} critical gap${criticalUnresolvedCount !== 1 ? "s" : ""} without a linked question`;
  } else {
    criticalGapStatus = "fail";
    criticalGapDetail = `${criticalUnresolvedCount} critical gaps unresolved — add to Questions tab`;
  }

  const scopeChecks: Check[] = [
    {
      label: "Gap analysis run",
      status: gapAnalysisRun ? "pass" : "caution",
      detail: gapAnalysisRun
        ? `${totalGapFindings} finding${totalGapFindings !== 1 ? "s" : ""} identified`
        : "Gap analysis not yet run",
    },
    {
      label: "Critical gaps resolved",
      status: criticalGapStatus,
      detail: criticalGapDetail,
    },
    {
      label: "Brief is current",
      status: brief?.isStale ? "caution" : "pass",
      detail: brief?.isStale
        ? "Addendum uploaded after brief — regenerate to include it"
        : "Brief reflects latest documents",
    },
  ];

  // ── GATE 4 — Bid Deadline ────────────────────────────────────────────────────

  let dueDateStatus: CheckStatus;
  let dueDateDetail: string;
  if (!dueDate) {
    dueDateStatus = "fail";
    dueDateDetail = "No bid due date set";
  } else {
    dueDateStatus = "pass";
    dueDateDetail = `Due ${dueDate.toLocaleDateString()}`;
  }

  let daysStatus: CheckStatus = "pass";
  let daysDetail = "Set a due date to check time remaining";
  if (daysUntilDue !== null) {
    if (daysUntilDue < 0) {
      daysStatus = "fail";
      daysDetail = `Bid due date passed ${Math.abs(daysUntilDue)} day${Math.abs(daysUntilDue) !== 1 ? "s" : ""} ago`;
    } else if (daysUntilDue < 7) {
      daysStatus = "fail";
      daysDetail = `${daysUntilDue} day${daysUntilDue !== 1 ? "s" : ""} remaining — critical`;
    } else if (daysUntilDue <= 14) {
      daysStatus = "caution";
      daysDetail = `${daysUntilDue} days remaining — limited time`;
    } else {
      daysStatus = "pass";
      daysDetail = `${daysUntilDue} days remaining`;
    }
    // Public bids need extra lead time
    if (bid.projectType === "PUBLIC" && daysUntilDue >= 0 && daysUntilDue < 14 && daysStatus === "pass") {
      daysStatus = "caution";
      daysDetail += " — public bids need extra lead time for compliance";
    }
  }

  const deadlineChecks: Check[] = [
    {
      label: "Bid due date set",
      status: dueDateStatus,
      detail: dueDateDetail,
    },
    {
      label: "Time remaining",
      status: daysUntilDue !== null ? daysStatus : "fail",
      detail: daysDetail,
    },
  ];

  // ── GATE 5 — Compliance (PUBLIC bids only) ────────────────────────────────

  let complianceChecks: Check[] | null = null;
  if (bid.projectType === "PUBLIC") {
    type ComplianceItem = { key: string; checked: boolean };
    let items: ComplianceItem[] = [];
    if (bid.complianceChecklist) {
      try {
        items = JSON.parse(bid.complianceChecklist) as ComplianceItem[];
      } catch { /* ignore */ }
    }

    const total = items.length;
    const checked = items.filter((i) => i.checked).length;

    if (total === 0) {
      complianceChecks = [
        {
          label: "Compliance checklist initialized",
          status: "caution",
          detail: "Open the compliance section on Overview to initialize the checklist",
        },
      ];
    } else {
      const pct = checked / total;
      complianceChecks = [
        {
          label: "Compliance items verified",
          status: pct >= 1 ? "pass" : pct >= 0.5 ? "caution" : "fail",
          detail:
            pct >= 1
              ? `All ${total} compliance items checked`
              : `${checked} of ${total} items checked — ${total - checked} remaining`,
        },
      ];

      // Check specific critical items
      const bidBond = items.find((i) => i.key === "bid_bond");
      if (bidBond && !bidBond.checked) {
        complianceChecks.push({
          label: "Bid bond",
          status: "fail",
          detail: "Bid bond is required for public bid submission",
        });
      }

      const dbeGoal = items.find((i) => i.key === "dbe_goal");
      if (dbeGoal && !dbeGoal.checked) {
        complianceChecks.push({
          label: "DBE goal",
          status: "caution",
          detail: "DBE participation goal not yet identified",
        });
      }
    }
  }

  // ── Assemble ─────────────────────────────────────────────────────────────────

  const gates: Gate[] = [
    {
      id: "readiness",
      label: "Project Readiness",
      score: gateScore(readinessChecks),
      checks: readinessChecks,
    },
    {
      id: "procurement",
      label: "Procurement Health",
      score: gateScore(procurementChecks),
      checks: procurementChecks,
    },
    {
      id: "scope",
      label: "Scope Confidence",
      score: gateScore(scopeChecks),
      checks: scopeChecks,
    },
    {
      id: "deadline",
      label: "Bid Deadline",
      score: gateScore(deadlineChecks),
      checks: deadlineChecks,
    },
    ...(complianceChecks
      ? [{
          id: "compliance" as const,
          label: "Compliance",
          score: gateScore(complianceChecks),
          checks: complianceChecks,
        }]
      : []),
  ];

  return Response.json({
    overall: overallScore(gates),
    gates,
    meta: {
      daysUntilDue,
      projectType: bid.projectType,
      isStubMode: false,
    },
  });
}
