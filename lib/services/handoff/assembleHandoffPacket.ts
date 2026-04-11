// Module H1 — Handoff Packet assembly
//
// Pure data aggregation. Compiles the bid + intake + awarded subs + open items
// + risk flags + documents into a single object that can be rendered to JSON
// (for the UI) or XLSX (for download).
//
// IMPORTANT — runs server-side ONLY:
// - Sub names and contact info are INCLUDED. The packet is internal — handed
//   from estimator to PM. It is NEVER sent to AI and NEVER exposed to subs.
// - EstimateUpload.pricingData is NEVER read or returned.
// - Per-trade dollar amounts are LEFT NULL in this module. Module H2 (Buyout
//   Tracker) is the natural source of truth for committed sub amounts. We
//   surface the total ourBidAmount from BidSubmission instead.

import { prisma } from "@/lib/prisma";

// ── Types ──────────────────────────────────────────────────────────────────

export type HandoffPacket = {
  generatedAt: string;
  bidId: number;
  status: string;
  isAwarded: boolean;

  project: {
    name: string;
    number: string; // "Bid #123" — synthesized from id (no separate field today)
    location: string | null;
    dueDate: string | null;
    projectType: string;
    deliveryMethod: string | null;
    ownerType: string | null;
    buildingType: string | null;
    approxSqft: number | null;
    stories: number | null;
    description: string | null;
    ourBidAmount: number | null; // total bid, from BidSubmission
  };

  constraints: {
    occupiedSpace: boolean;
    phasingRequired: boolean;
    siteConstraints: string | null;
    estimatorNotes: string | null;
    scopeBoundaryNotes: string | null;
    veInterest: boolean;
    ldAmountPerDay: number | null; // PUBLIC bids
    ldCapAmount: number | null; // PUBLIC bids
    dbeGoalPercent: number | null; // PUBLIC bids
  };

  trades: TradeAward[];
  awardedSubs: AwardedSub[];

  openItems: {
    unresolvedRfis: UnresolvedRfi[];
    unresolvedAssumptions: UnresolvedAssumption[];
  };

  riskFlags: RiskFlag[];
  documents: HandoffDocument[];

  complianceStatus: ComplianceStatus | null; // null for non-PUBLIC bids
};

export type TradeAward = {
  tradeId: number;
  tradeName: string;
  csiCode: string | null;
  costCode: string | null;
  tier: string;
  leadTimeDays: number | null;
  awardedSubcontractorId: number | null;
  awardedSubName: string | null;
  awardedContactName: string | null;
  awardedContactEmail: string | null;
  awardedContactPhone: string | null;
  // Per-trade buyout amount: NULL in H1 (no source).
  // Module H2 (Buyout Tracker) will populate this from a future BuyoutItem model.
  bidAmount: number | null;
  // Hardcoded "PENDING" in H1. Module H2 will derive from BuyoutItem.contractStatus.
  contractStatus: "PENDING";
};

export type AwardedSub = {
  subcontractorId: number;
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  trades: string[];
  contractStatus: "PENDING";
};

export type UnresolvedRfi = {
  id: number;
  rfiNumber: number | null;
  question: string;
  trade: string | null;
  status: string;
  priority: string;
  dateAsked: string | null;
  dueDate: string | null;
};

export type UnresolvedAssumption = {
  assumption: string;
  sourceRef: string | null;
  urgency: string;
};

export type RiskFlag = {
  flag: string;
  severity: string;
  foundIn: string | null;
  potentialImpact: string | null;
  recommendedAction: string | null;
};

export type HandoffDocument = {
  fileName: string;
  type: "spec" | "drawing" | "addendum";
  uploadedAt: string;
  reference: string | null; // e.g. addendum number
};

export type ComplianceStatus = {
  totalItems: number;
  checkedItems: number;
  percentComplete: number;
  items: Array<{ key: string; label: string; checked: boolean; notes: string | null }>;
};

// ── Assembler ──────────────────────────────────────────────────────────────

export async function assembleHandoffPacket(bidId: number): Promise<HandoffPacket | null> {
  // Single big query — let Prisma do the joins
  const bid = await prisma.bid.findUnique({
    where: { id: bidId },
    include: {
      submission: true,
      intelligenceBrief: {
        select: {
          riskFlags: true,
          assumptionsToResolve: true,
        },
      },
      bidTrades: {
        include: { trade: true },
        orderBy: { id: "asc" },
      },
      selections: {
        include: {
          subcontractor: {
            include: {
              contacts: { orderBy: [{ isPrimary: "desc" }, { id: "asc" }], take: 1 },
            },
          },
        },
      },
      generatedQuestions: {
        where: {
          status: { in: ["OPEN", "SENT"] },
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      },
      specBooks: { select: { fileName: true, uploadedAt: true } },
      drawingUploads: { select: { fileName: true, uploadedAt: true } },
      addendums: {
        select: { fileName: true, uploadedAt: true, addendumNumber: true },
        orderBy: { addendumNumber: "asc" },
      },
    },
  });

  if (!bid) return null;

  // ── Trades ──────────────────────────────────────────────────────────────
  // For each BidTrade, find the "awarded" sub. We use rfqStatus === "accepted"
  // as the award signal (the closest thing in the current schema). If multiple
  // selections on the same trade are accepted, pick the first; if none are
  // accepted, awarded fields are null.
  const trades: TradeAward[] = bid.bidTrades.map((bt) => {
    const accepted = bid.selections.find(
      (sel) => sel.tradeId === bt.tradeId && sel.rfqStatus === "accepted"
    );
    const sub = accepted?.subcontractor ?? null;
    const contact = sub?.contacts[0] ?? null;

    return {
      tradeId: bt.tradeId,
      tradeName: bt.trade.name,
      csiCode: bt.trade.csiCode,
      costCode: bt.trade.costCode,
      tier: bt.tier,
      leadTimeDays: bt.leadTimeDays,
      awardedSubcontractorId: sub?.id ?? null,
      awardedSubName: sub?.company ?? null,
      awardedContactName: contact?.name ?? null,
      awardedContactEmail: contact?.email ?? null,
      awardedContactPhone: contact?.phone ?? null,
      bidAmount: null, // Deferred to Module H2
      contractStatus: "PENDING" as const,
    };
  });

  // ── Awarded Subs (deduped by sub, with all trades collapsed) ────────────
  type SubGroup = {
    subcontractorId: number;
    companyName: string;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    trades: string[];
  };
  const groupMap = new Map<number, SubGroup>();
  for (const t of trades) {
    if (!t.awardedSubcontractorId || !t.awardedSubName) continue;
    let group = groupMap.get(t.awardedSubcontractorId);
    if (!group) {
      group = {
        subcontractorId: t.awardedSubcontractorId,
        companyName: t.awardedSubName,
        contactName: t.awardedContactName,
        contactEmail: t.awardedContactEmail,
        contactPhone: t.awardedContactPhone,
        trades: [],
      };
      groupMap.set(t.awardedSubcontractorId, group);
    }
    if (!group.trades.includes(t.tradeName)) group.trades.push(t.tradeName);
  }
  const awardedSubs: AwardedSub[] = Array.from(groupMap.values()).map((g) => ({
    ...g,
    contractStatus: "PENDING" as const,
  }));

  // ── Open RFIs ───────────────────────────────────────────────────────────
  const unresolvedRfis: UnresolvedRfi[] = bid.generatedQuestions.map((q) => ({
    id: q.id,
    rfiNumber: q.rfiNumber,
    question: q.questionText,
    trade: q.tradeName,
    status: q.status,
    priority: q.priority,
    dateAsked: q.createdAt.toISOString(),
    dueDate: q.dueDate?.toISOString() ?? null,
  }));

  // ── Unresolved assumptions (parsed from brief JSON) ─────────────────────
  const unresolvedAssumptions: UnresolvedAssumption[] = [];
  if (bid.intelligenceBrief?.assumptionsToResolve) {
    try {
      const parsed = JSON.parse(bid.intelligenceBrief.assumptionsToResolve) as Array<{
        assumption?: string;
        sourceRef?: string;
        urgency?: string;
      }>;
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          if (!a.assumption) continue;
          unresolvedAssumptions.push({
            assumption: a.assumption,
            sourceRef: a.sourceRef ?? null,
            urgency: a.urgency ?? "before_bid_day",
          });
        }
      }
    } catch {
      // ignore malformed
    }
  }

  // ── Risk flags (parsed from brief JSON) ─────────────────────────────────
  const riskFlags: RiskFlag[] = [];
  if (bid.intelligenceBrief?.riskFlags) {
    try {
      const parsed = JSON.parse(bid.intelligenceBrief.riskFlags) as Array<{
        flag?: string;
        severity?: string;
        foundIn?: string;
        potentialImpact?: string;
        recommendedAction?: string;
      }>;
      if (Array.isArray(parsed)) {
        for (const r of parsed) {
          if (!r.flag) continue;
          riskFlags.push({
            flag: r.flag,
            severity: r.severity ?? "moderate",
            foundIn: r.foundIn ?? null,
            potentialImpact: r.potentialImpact ?? null,
            recommendedAction: r.recommendedAction ?? null,
          });
        }
      }
    } catch {
      // ignore
    }
  }

  // ── Documents inventory ─────────────────────────────────────────────────
  const documents: HandoffDocument[] = [
    ...bid.specBooks.map((s) => ({
      fileName: s.fileName,
      type: "spec" as const,
      uploadedAt: s.uploadedAt.toISOString(),
      reference: null,
    })),
    ...bid.drawingUploads.map((d) => ({
      fileName: d.fileName,
      type: "drawing" as const,
      uploadedAt: d.uploadedAt.toISOString(),
      reference: null,
    })),
    ...bid.addendums.map((a) => ({
      fileName: a.fileName,
      type: "addendum" as const,
      uploadedAt: a.uploadedAt.toISOString(),
      reference: `Addendum ${a.addendumNumber}`,
    })),
  ];

  // ── Compliance status (PUBLIC bids only) ────────────────────────────────
  let complianceStatus: ComplianceStatus | null = null;
  if (bid.projectType === "PUBLIC" && bid.complianceChecklist) {
    try {
      const items = JSON.parse(bid.complianceChecklist) as Array<{
        key: string;
        label?: string;
        checked?: boolean;
        notes?: string;
      }>;
      if (Array.isArray(items)) {
        const total = items.length;
        const checked = items.filter((i) => i.checked).length;
        complianceStatus = {
          totalItems: total,
          checkedItems: checked,
          percentComplete: total > 0 ? Math.round((checked / total) * 100) : 0,
          items: items.map((i) => ({
            key: i.key,
            label: i.label ?? i.key,
            checked: Boolean(i.checked),
            notes: i.notes ?? null,
          })),
        };
      }
    } catch {
      // ignore
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    bidId: bid.id,
    status: bid.status,
    isAwarded: bid.status === "awarded",

    project: {
      name: bid.projectName,
      number: `Bid #${bid.id}`,
      location: bid.location,
      dueDate: bid.dueDate?.toISOString() ?? null,
      projectType: bid.projectType,
      deliveryMethod: bid.deliveryMethod,
      ownerType: bid.ownerType,
      buildingType: bid.buildingType,
      approxSqft: bid.approxSqft,
      stories: bid.stories,
      description: bid.description,
      ourBidAmount: bid.submission?.ourBidAmount ?? null,
    },

    constraints: {
      occupiedSpace: bid.occupiedSpace,
      phasingRequired: bid.phasingRequired,
      siteConstraints: bid.siteConstraints,
      estimatorNotes: bid.estimatorNotes,
      scopeBoundaryNotes: bid.scopeBoundaryNotes,
      veInterest: bid.veInterest,
      ldAmountPerDay: bid.ldAmountPerDay,
      ldCapAmount: bid.ldCapAmount,
      dbeGoalPercent: bid.dbeGoalPercent,
    },

    trades,
    awardedSubs,

    openItems: {
      unresolvedRfis,
      unresolvedAssumptions,
    },

    riskFlags,
    documents,
    complianceStatus,
  };
}
